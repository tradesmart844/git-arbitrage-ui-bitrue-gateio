import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { SymbolManagerService } from './symbol-manager.service';
import { AppService } from './app.service';
import {
  HTTPMethods,
  MessageTypes,
  OrderStatus,
  OrderType,
  Price,
  Quantity,
  Segment,
  SymbolType,
  TradeInterface,
  TransactionType,
} from '../helpers/enums';
import { IOrder } from '../interfaces/order-interface';
import { IAccountBalance } from '../interfaces/account-balance-interface';
import { HmacSHA512, SHA512, enc } from 'crypto-js';
import * as pako from 'pako';
import * as protobuf from 'protobufjs';
import { CryptoCoin } from '../models/crypto-coin';
import { SymbolCrypto } from '../models/symbol-crypto';
import { AccountBalance } from '../models/account-balance';
import { Order } from '../models/order';
import { ISymbol } from '../interfaces/symbol-interface';
import { MarketDepthInfo, MarketDepths } from '../models/market-depths';
import { curry, isNumber } from 'lodash';
import { Subscription, timestamp } from 'rxjs';
import { MessageDataInterface } from '../interfaces/message-data-interface';
import { LocalStorageService } from './local-storage.service';
import { GateIOCredentials } from '../config/api-credentials';

const proto = `
syntax = "proto3";

// The outer wrapper for the stream message, matching the debugger output.
message StreamWrapper {
  string channel = 1;
  bytes data = 303;     // The order book data payload
  string symbol = 3;
  int64 sendtime = 6; // Correct field number for the timestamp
}

// The schema for the depth data itself.
message PublicLimitDepthsData {
  repeated DepthItem asks = 1;
  repeated DepthItem bids = 2;
}

message DepthItem {
  string price = 1;
  string quantity = 2;
}

// The schema for private order updates.
message PrivateOrdersV3ApiBaseMessage {
  string channel = 1;
  string symbol = 3;
  int64 updateTime = 6;
  bytes data = 304;
};

// The schema for private order updates.
message PrivateOrdersV3Api {
  string orderId = 1;
  string clientId = 2;

  string orderPrice = 3;
  string orderQuantity = 4;
  string orderAmount = 5;
  string avgPrice = 6;

  int32 orderType = 7;
  int32 tradeType = 8;
  bool isMaker = 9;

  string remainAmount = 10;
  string remainQuantity= 11;
  optional string lastDealQuantity = 12;
  string cumulativeQuantity = 13;
  string cumulativeAmount = 14;

  int32 orderStatus = 15;
  int64 createTime = 16;
}

// The schema for private order updates.
message PrivateAccountV3ApiBaseMessage {
  string channel = 1;
  int64 updateTime = 6;
  bytes data = 307;
};

message PrivateAccountV3Api {
  string coinName = 1;
  string coinId = 2;

  string balanceAmount = 3;
  string balanceAmountChange = 4;
  string frozenAmount = 5;
  string frozenAmountChange = 6;

  string type = 7;

  int64 time = 8;
}`;

const root = protobuf.parse(proto).root;
const StreamWrapper = root.lookupType('StreamWrapper');
const PublicLimitDepthsData = root.lookupType('PublicLimitDepthsData');
const PrivateOrdersV3ApiBaseMessage = root.lookupType('PrivateOrdersV3ApiBaseMessage');
const PrivateOrdersV3Api = root.lookupType('PrivateOrdersV3Api');
const PrivateAccountV3ApiBaseMessage = root.lookupType('PrivateAccountV3ApiBaseMessage');
const PrivateAccountV3Api = root.lookupType('PrivateAccountV3Api');
declare var ze: any;

@Injectable({
  providedIn: 'root',
})
export class GateIOApiInteractiveService {
  private readonly apiUrl = 'https://api.gateio.ws';
  private readonly apiKey = GateIOCredentials.apiKey;
  private readonly apiSecret = GateIOCredentials.apiSecret;
  private readonly defaultRecvWindow = 25000;
  tradeInterface: TradeInterface;
  segment: Segment;
  socketUrl: string;
  socketFuturesUrl: string;
  futuresMarketDataSocket: WebSocket | undefined;
  openOrders: Map<string, IOrder>;
  balances: Map<string, IAccountBalance>;
  listernerKey: string;
  isPongTimerInitialized = false;
  interactiveSocket: WebSocket | undefined;
  marketDataSocket: WebSocket | undefined;
  appSubscription: Subscription | undefined;
  xrpUSDTWindow: Window | null;
  placeOrderInProgress: boolean;
  private heartbeatInterval: any;
  private listenerKeyExtensionInterval: any;
  private pingPongIntervalFuturesSocket: any;
  private pingPongIntervalMarketDataSocket: any;
  private pingPongIntervalInteractiveSocket: any;
  symbols: string[] = [
    // 'XDCUSDT',
    // 'SOLOUSDT',
    // 'COREUMUSDT',
    //'XLMUSDT',
    'QNTUSDT',
    // 'EWTUSDT',
    // 'XRPUSDT',
    // 'HBARUSDT',
  ];

  constructor(
    private httpClient: HttpClient,
    private symbolManagerService: SymbolManagerService,
    private appService: AppService,
    private localStorageService: LocalStorageService
  ) {
    this.tradeInterface = TradeInterface.GateIOApi;
    this.segment = Segment.GateIO;;
    this.socketUrl = 'wss://api.gateio.ws/ws/v4/';
    this.socketFuturesUrl = 'wss://fx-ws.gateio.ws/v4/ws/usdt';
    this.openOrders = new Map<string, IOrder>();
    this.balances = new Map<string, IAccountBalance>();
    this.listernerKey = '';
    this.xrpUSDTWindow = null;
    this.placeOrderInProgress = false;
    this.futuresMarketDataSocket = undefined;
    this.pingPongIntervalFuturesSocket = undefined;
    this.pingPongIntervalMarketDataSocket = undefined;
    this.pingPongIntervalInteractiveSocket = undefined;
  }

  async init() {
    await this.getSymbols();
    await this.getBalance();
    await this.loanRatio();
    // //this.xrpUSDTWindow = window.open('https://www.mexc.com/exchange/XRP_USDT');

    //await this.getAllOpenOrders();

    // // this.appService.appEvents.on(
    // //   MessageTypes.GET_ALL_OPEN_ORDERS_EVENT,
    // //   this.getAllOpenOrders.bind(this)
    // // );

    // // this.appService.appEvents.on(
    // //   MessageTypes.GET_BALANCE_EVENT,
    // //   this.getBalance.bind(this)
    // // );

    // // this.appService.appEvents.on(
    // //   MessageTypes.CANCEL_ORDER_EVENT,
    // //   this.cancelOrder.bind(this)
    // // );

    this.appSubscription = this.appService.appEvents.subscribe(
      (message: MessageDataInterface<any>) => {
        // Handle different types of messages
        switch (message.MessageType) {
          case MessageTypes.CANCEL_ORDER_EVENT:
            this.cancelOrder.bind(this)(message.Data as IOrder);
            break;
          case MessageTypes.GET_ALL_OPEN_ORDERS_EVENT:
            this.getAllOpenOrders.bind(this)();
            break;
          case MessageTypes.GET_BALANCE_EVENT:
            this.getBalance.bind(this)();
            break;
        }
      }
    );

    setTimeout(() => {
      this.connectInteractiveSocket();
    }, 1000);

    setTimeout(() => {
      this.connectMarketDataSocket('')
    }, 1000);

    setTimeout(() => {
      this.connectFuturesMarketDataSocket('')
    }, 1000);

    // //this.connectInteractiveSocket();
    // //this.connectMarketDataSocket('');
  }

  async connectFuturesMarketDataSocket(symbol: string) {
    //this.futuresMarketDataSocket = new WebSocket(`${this.socketFuturesUrl}`);
    //this.registerFuturesMarketDataEvents(this.futuresMarketDataSocket, symbol);
  }

  async registerFuturesMarketDataEvents(futuresMarketDataSocket: WebSocket, symbol: string) {
    futuresMarketDataSocket.onopen = async () => {
      console.info(
        `${TradeInterface[this.tradeInterface]} ${symbol} futures marketData socket connected.`
      );

      //futures.positions

      futuresMarketDataSocket.send(
        this.createSignedRequest('futures.positions', 'subscribe', [
          "QNT_USDT_2025", '!all'
        ])
      );

      if (!this.pingPongIntervalFuturesSocket) {
        //ws.send('{"time" : 123456, "channel" : "futures.ping"}')
        this.pingPongIntervalFuturesSocket = setInterval(() => {
          futuresMarketDataSocket.send(JSON.stringify({ time: new Date().getTime(), channel: 'futures.ping' }));
        }, 30000);
      }
    };

    futuresMarketDataSocket.onclose = async () => {
      console.error(
        `${TradeInterface[this.tradeInterface]} ${symbol} futures marketData socket closed.`
      );

      clearInterval(this.pingPongIntervalFuturesSocket);
      this.pingPongIntervalFuturesSocket = undefined;

      setTimeout(() => {
        this.connectFuturesMarketDataSocket('');
      }, 3000);
    };

    futuresMarketDataSocket.onerror = async (error) => {
      console.error(
        `${TradeInterface[this.tradeInterface]} ${symbol} futures marketData socket error: ${JSON.stringify(error)}`
      );
    };

    futuresMarketDataSocket.onmessage = async (message: any) => {
      if (message && message.data) {
        let messageData = JSON.parse(message.data);

        if (messageData && messageData.event === 'subscribe') {
          if (messageData.result && messageData.result.status == 'success') {
            console.info(`${TradeInterface[this.tradeInterface]} channel ${messageData.channel} subscribed successfully.\n${JSON.stringify(messageData.payload)}`);
          } else {
            console.error(`${TradeInterface[this.tradeInterface]} channel ${messageData.channel} subscription failed.\n${JSON.stringify(messageData.result)}`);
          }
        }

        if (messageData.channel === 'futures.ping') {
          console.info(`${TradeInterface[this.tradeInterface]} futures.ping received.`);
        }

        if (messageData.channel === 'futures.pong') {
          console.info(`${TradeInterface[this.tradeInterface]} futures.pong received.`);
        }

        if (messageData && messageData.event === 'update') {
          switch (messageData.channel) {
            case 'futures.positions':
              {
                let test = messageData;
              }
              break;
          }
        }
      }
    };
  }
  async http_request(
    endpoint: string,
    method: HTTPMethods,
    query: any = {},
    data: any = {},
    Info = '',
    contenType = ''
  ) {
    try {
      const timestamp = (new Date().getTime() / 1000).toString();

      let httpParams = new HttpParams({ fromObject: query || {} });
      let queryString = httpParams.toString();
      let body: string | null = null;

      let bodyParam = '';

      if (data) {
        if (typeof data == 'string') {
          bodyParam = data;
        } else {
          bodyParam = JSON.stringify(data);
        }
      }

      const hashedPayload = SHA512(bodyParam).toString(enc.Hex);
      const signatureString = [method, endpoint, queryString, hashedPayload, timestamp].join('\n');
      const signature = HmacSHA512(signatureString, this.apiSecret).toString(
        enc.Hex
      );

      let headers: any = {
        Accept: 'application/json',
        KEY: this.apiKey,
        SIGN: signature,
        Timestamp: timestamp,
      };


      if (contenType) {
        headers['Content-Type'] = contenType;
      }

      const fullendpoint: string = this.apiUrl + endpoint;

      switch (method) {
        case HTTPMethods.GET:
          return await this.httpClient
            .get<any>(`${fullendpoint}`, {
              headers: headers,
              params: query,
            })
            .toPromise();
        case HTTPMethods.POST:
          return await this.httpClient
            .post<any>(`${fullendpoint}`, bodyParam, {
              headers: headers,
              params: query,
            })
            .toPromise();
        case HTTPMethods.PUT:
          return await this.httpClient
            .put<any>(`${fullendpoint}`, body, {
              headers: headers,
            })
            .toPromise();
        case HTTPMethods.DELETE:
          return await this.httpClient
            .delete<any>(`${fullendpoint}`, {
              headers: headers,
              params: httpParams,
            })
            .toPromise();
      }
    } catch (error) {
      console.error(Info + ' Error: ', error);
      return null;
    }
  }

  async getSymbols() {
    let storedCoins = await this.localStorageService.getItem(
      `${TradeInterface[this.tradeInterface]}-coins`
    );

    let coins = [];

    if (storedCoins) {
      coins = JSON.parse(storedCoins);
    }

    if (coins.length == 0) {
      coins = await this.http_request(
        '/api/v4/spot/currencies',
        HTTPMethods.GET,
        null,
        'getCoins'
      );

      if (coins && coins.length > 0) {
        this.localStorageService.setItem(
          `${TradeInterface[this.tradeInterface]}-coins`,
          JSON.stringify(coins)
        );
      }
    }

    if (coins && coins.length > 0) {
      for (let index = 0; index < coins.length; index++) {
        let coin = coins[index];

        let cryptoCoin = new CryptoCoin(
          this.tradeInterface,
          this.segment,
          coin.currency,
          coin.name,
          !coin.withdraw_disabled,
          !coin.deposit_disabled,
          0,
          0,
          0,
          coin.chains
        );

        this.symbolManagerService.setCryptoCoin(cryptoCoin);
      }
    }

    console.log(
      `${TradeInterface[this.tradeInterface]} Total coins fetched: ${coins.length
      }`
    );

    let symbols = [];

    let storedSymbols = await this.localStorageService.getItem(
      `${TradeInterface[this.tradeInterface]}-symbols`
    );

    if (storedSymbols && storedSymbols.length > 0) {
      symbols = JSON.parse(storedSymbols);
    } else {
      let result = await this.http_request(
        '/api/v4/spot/currency_pairs',
        HTTPMethods.GET,
        null,
        'getSymbols'
      );

      if (result.length > 0) {
        symbols = result;

        this.localStorageService.setItem(
          `${TradeInterface[this.tradeInterface]}-symbols`,
          JSON.stringify(symbols)
        );
      }
    }

    if (symbols.length > 0) {
      for (let index = 0; index < symbols.length; index++) {
        let symbol = symbols[index];

        let symbolCrypto = new SymbolCrypto(
          this.tradeInterface,
          this.segment,
          symbol.id.replace('_', ''),
          SymbolType.CRYPTO,
          symbol.base_name,
          symbol.id,
          1 / Math.pow(10, parseFloat(symbol.amount_precision)),
          1 / Math.pow(10, parseFloat(symbol.precision)),
          symbol.precision,
          symbol.base,
          symbol.quote
        );

        this.symbolManagerService.setSymbol(symbolCrypto);
      }
    }

    console.log(
      `${TradeInterface[this.tradeInterface]} Total symbols fetched: ${symbols.length
      }`
    );
  }

  async getBalance() {
    let balances = await this.http_request(
      '/api/v4/spot/accounts',
      HTTPMethods.GET,
      {},
      null,
      'getBalance',
      ''
    );

    if (balances && balances.length > 0) {
      for (let index = 0; index < balances.length; index++) {
        let balance = balances[index];

        let cryptoCoin = this.symbolManagerService.getCryptoCoin(
          this.tradeInterface,
          this.segment,
          balance.currency
        );

        if (cryptoCoin) {
          let accountBalance = new AccountBalance(
            cryptoCoin,
            parseFloat(balance.available),
            parseFloat(balance.locked)
          );

          this.appService.appEvents.emit({
            MessageType: MessageTypes.BALANCE_UPDATE_EVENT,
            Data: accountBalance,
          });
        }
      }
    }
  }

  async getAllOpenOrders() {
    let openOrders = await this.http_request(
      '/api/v4/spot/open_orders',
      HTTPMethods.GET,
      {},
      null,
      'getAllOpenOrders'
    );

    console.info(`Open Orders: ${JSON.stringify(openOrders)}`);

    if (openOrders && openOrders.length > 0) {
      for (let index = 0; index < openOrders.length; index++) {
        let order = openOrders[index];

        let symbol = this.symbolManagerService.getSymbol(
          this.tradeInterface,
          this.segment,
          order.currency_pair.replace('_', '')
        );

        if (symbol) {
          if (order.orders && order.orders.length > 0) {
            for (let orderIndex = 0; orderIndex < order.orders.length; orderIndex++) {
              let orderItem = order.orders[orderIndex];

              if (parseFloat(orderItem.filled_amount) > 0 && parseFloat(orderItem.filled_amount) < parseFloat(orderItem.amount)) {
                orderItem.finish_as = 'PARTIALLY_FILLED';
              }

              let orderNew = new Order(
                symbol,
                orderItem.id,
                this.convertToTransactionType(orderItem.side),
                this.convertToOrderType(orderItem.type),
                parseFloat(orderItem.amount),
                parseFloat(orderItem.price),
                parseFloat(orderItem.amount) - parseFloat(orderItem.left),
                parseFloat(orderItem.fill_price),
                orderItem.create_time_ms,
                orderItem.update_time_ms,
                this.convertToOrderStatus(orderItem.finish_as),
                0,
                orderItem.amend_text || ''
              );

              this.appService.appEvents.emit({
                MessageType: MessageTypes.ORDER_UPDATE_EVENT,
                Data: orderNew,
              });
            }
          }
        }
      }
    }
  }

  async cancelOrder(order: IOrder) {
    // ignore cancel order if order is not from this segment or trade interface
    if (
      order.symbol.segment != this.segment &&
      order.symbol.tradeInterface != this.tradeInterface
    ) {
      return;
    }

    let cancelOrderResponse = await this.http_request(
      '/api/v4/spot/orders/' + order.orderId,
      HTTPMethods.DELETE,
      {
        currency_pair: order.symbol.uniqueName,
      },
      null,
      'cancelOrder'
    );

    console.info(
      `Cancel Order Response: ${JSON.stringify(cancelOrderResponse)}`
    );
  }

  async wait(seconds: number) {
    new Promise(resolve => setTimeout(resolve, seconds * 1000));
  }

  async placeOrder(
    symbol: ISymbol,
    transactionType: TransactionType,
    orderType: OrderType,
    orderPrice: Price,
    orderQuantity: Quantity,
    magicNumber: string = '',
    placeOrderViaWeb = false
  ) {
    //Wait for 1 second if placeOrderInProgress is true to avoid rate limit 1 order per second
    if (this.placeOrderInProgress) {
      await this.wait(1);
    }

    this.placeOrderInProgress = true;
    try {
      let orderDetails: any = {
        currency_pair: symbol.uniqueName,
        side: TransactionType[transactionType].toLowerCase(),
        type: OrderType[orderType].toLowerCase(),
        amount: orderQuantity.toString(),
        price: orderPrice.toString(),
        account: 'spot'
      }

      if (magicNumber) {
        orderDetails.text = magicNumber;
      }

      // Always attempt API order placement
      let placeOrderResponse = await this.http_request(
        '/api/v4/spot/orders',
        HTTPMethods.POST,
        {},
        orderDetails,
        'placeOrder',
        'application/json'
      );

      if (!placeOrderResponse) {
        throw new Error('No response received from order placement API');
      }

      console.info(
        `${TradeInterface[this.tradeInterface]} Place Order Response: ${JSON.stringify(placeOrderResponse)}`
      );
      this.placeOrderInProgress = false;

      return placeOrderResponse;
    } catch (error) {
      this.placeOrderInProgress = false;
      const errorMsg = `Unable to place order for ${TradeInterface[symbol.tradeInterface]} for symbol ${symbol.token}, reason: ${(<Error>error).message}`;
      console.error(errorMsg);
      throw new Error(errorMsg); // Propagate error to caller
    }
  }

  async withdrawCoin(
    symbol: string,
    chainName: string,
    withdrawAddress: string,
    amount: string | number,
    memo: string = ''
  ) {
    try {
      let finalSymbol = this.symbolManagerService.getCryptoCoin(this.tradeInterface, this.segment, symbol);

      if (!finalSymbol) {
        console.error(`${TradeInterface[this.tradeInterface]} Symbol not found for symbol ${symbol}.`);
        return;
      }

      let withdrawDetails: any = {
        //Return only order id with number of seconds & not decimal seconds part
        withdraw_order_id: `order_${Math.floor(Date.now() / 1000)}`.toString(),
        currency: finalSymbol.coin,
        address: withdrawAddress,
        amount: amount.toString(),
        chain: chainName,
      };

      if (memo) {
        withdrawDetails.memo = memo;
      }

      let withdrawCoinResponse = await this.http_request(
        '/api/v4/withdrawals',
        HTTPMethods.POST,
        {},
        withdrawDetails,
        'withdrawCoin'
      );
    } catch (error) {
      console.error(
        `Unable to withdraw for ${TradeInterface[this.tradeInterface]
        } for symbol ${symbol}, reason: ${(<Error>error).message}`
      );
    }

    try {
      //coin=EOS&address=zzqqqqqqqqqq&amount=10&network=EOS&memo=MX10086&timestamp={{timestamp}}&signature={{signature}}
      // let withdrawDetails: any = {
      //   coin: symbol,
      //   address: withdrawAddress,
      //   amount: amount,
      //   network: chainName,
      // };
      // if (memo) {
      //   withdrawDetails.memo = memo;
      // }
      // let withdrawCoinResponse = await this.http_request(
      //   '/api/v3/capital/withdraw/address',
      //   HTTPMethods.GET,
      //   {
      //     coin: 'SOLO',
      //   },
      //   'withdrawCoin'
      // );
      // let test = withdrawCoinResponse;
    } catch (error) {
      console.error(
        `Unable to withdraw for ${TradeInterface[this.tradeInterface]
        } for symbol ${symbol}, reason: ${(<Error>error).message}`
      );
    }
  }

  /**
   * Gets a specific order by symbol and magic number (client order ID) from GATEIO API
   * @param symbol Trading symbol
   * @param magicNumber Magic number (client order ID)
   * @returns Array containing the order if found, otherwise empty array
   */
  async getOrdersByMagicNumber(symbol: string, magicNumber: string): Promise<IOrder[]> {
    try {
      // Use the /api/v3/order endpoint to query by clientOrderId
      const orderResponse = await this.http_request(
        '/api/v4/spot/orders', // Correct endpoint
        HTTPMethods.GET,
        {},
        {
          currency_pair: symbol,
          text: magicNumber // Query parameter for clientOrderId
        },
        'getOrdersByMagicNumber',
        'application/json'
      );

      const orders: IOrder[] = [];

      // Check if the response is valid and represents a single order object
      if (orderResponse && typeof orderResponse === 'object' && orderResponse.orders && orderResponse.orders.length > 0) {
        const order = orderResponse; // Response should be the single order details
        const symbolObj = this.symbolManagerService.getSymbol(
          this.tradeInterface,
          this.segment,
          order.currency_pair.replace('_', '')
        );

        if (symbolObj) {
          const orderObj = new Order(
            symbolObj,
            order.orderId,
            this.convertToTransactionType(order.side),
            this.convertToOrderType(order.type),
            parseFloat(order.origQty),
            parseFloat(order.price),
            parseFloat(order.executedQty),
            parseFloat(order.cummulativeQuoteQty) / parseFloat(order.executedQty) || parseFloat(order.price), // Calculate average price if possible
            order.time,
            order.updateTime,
            this.convertToOrderStatus(order.status),
            0, // otherQuantity - Assuming not applicable here
            order.clientOrderId
          );
          orders.push(orderObj);
        } else {
          console.error(`[${TradeInterface[this.tradeInterface]}] Symbol not found for order:`, order.symbol);
        }
      } else if (Array.isArray(orderResponse)) {
        // Handle cases where the API might unexpectedly return an array (e.g., if clientOrderId wasn't unique, though it should be)
        console.warn(`[${TradeInterface[this.tradeInterface]}] Unexpected array response when querying order by magicNumber ${magicNumber}`, orderResponse);
        // Potentially process the first element if applicable, or handle as needed
      }

      return orders; // Return array (potentially empty or with one order)
    } catch (error: any) {
      // Handle specific API errors, e.g., "Order does not exist"
      if (error?.response?.data?.msg === 'Order does not exist.') {
        console.log(`[${TradeInterface[this.tradeInterface]}] Order with magicNumber ${magicNumber} for symbol ${symbol} not found.`);
      } else {
        console.error(`[${TradeInterface[this.tradeInterface]}] Error fetching order by magicNumber ${magicNumber} for symbol ${symbol}:`, error);
      }
      return []; // Return empty array on error
    }
  }

  async loanRatio() {
    try {
      let loanRatioResponse = await this.http_request(
        '/api/v4/loan/collateral/ltv',
        HTTPMethods.GET,
        {
          collateral_currency: 'XRP',
          borrow_currency: 'QNT'
        },
        null,
        'loanRatio'
      );
      console.info(`Loan Ratio Response: ${JSON.stringify(loanRatioResponse)}`);
    } catch (error: any) {
      console.error(`[${TradeInterface[this.tradeInterface]}] Error fetching loan ratio:`, error);
    }

  }

  async createListenerKey() {
    try {
      let listenerKeyResponse = await this.http_request(
        '/api/v3/userDataStream',
        HTTPMethods.POST,
        null,
        'createListenerKey'
      );

      if (listenerKeyResponse && listenerKeyResponse.listenKey) {
        this.listernerKey = listenerKeyResponse.listenKey;
        //this.extendListenerKeyValidity();
      }
    } catch (error) {
      console.error(
        `Unable to create listener key for ${TradeInterface[this.tradeInterface]
        } interactive socket. Reason: ${(<Error>error).message}`
      );
    }
  }

  async extendListenerKeyValidity() {
    let timer = setTimeout(async () => {
      clearTimeout(timer);
      try {
        let listenerKeyResponse = await this.http_request(
          '/api/v3/userDataStream',
          HTTPMethods.PUT,
          {
            listenKey: this.listernerKey,
          },
          'extendListenerKeyValidity'
        );
      } catch (error: any) {
        console.error(
          `Unable to externd listener key ${this.listernerKey
          } for ${this.tradeInterface.toString()} interactive socket. Reason: ${error.message
          }`
        );
      }
    }, 60000);
  }

  private startHeartbeat() {
    this.stopHeartbeat(); // Clear any existing interval
    this.heartbeatInterval = setInterval(() => {
      if (this.interactiveSocket?.readyState === WebSocket.OPEN) {
        this.interactiveSocket.send(JSON.stringify({
          method: "PING"
        }));
      }
    }, 60000); // Send ping every 30 seconds
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private startListenerKeyExtension() {
    this.stopListenerKeyExtension(); // Clear any existing interval
    this.listenerKeyExtensionInterval = setInterval(async () => {
      await this.extendListenerKeyValidity();
    }, 1800000); // Extend every 30 minutes
  }

  private stopListenerKeyExtension() {
    if (this.listenerKeyExtensionInterval) {
      clearInterval(this.listenerKeyExtensionInterval);
      this.listenerKeyExtensionInterval = null;
    }
  }

  async connectInteractiveSocket() {
    this.interactiveSocket = undefined;
    //await this.createListenerKey();

    this.interactiveSocket = new WebSocket(
      `${this.socketUrl}`
    );

    this.registerInteractiveEvents();
  }

  async registerInteractiveEvents() {
    if (this.interactiveSocket) {
      this.interactiveSocket.onopen = async () => {
        console.info(
          `${TradeInterface[this.tradeInterface]} interactive socket connected.`
        );

        if (!this.pingPongIntervalInteractiveSocket) {
          this.pingPongIntervalInteractiveSocket = setInterval(() => {
            this.interactiveSocket?.send(JSON.stringify({ time: new Date().getTime(), channel: 'spot.ping' }));
          }, 30000);
        }

        this.interactiveSocket?.send(
          this.createSignedRequest('spot.balances', 'subscribe', null)
        );

        for (let index = 0; index < this.symbols.length; index++) {
          let symbol = this.symbols[index];

          let finalSymbol = this.symbolManagerService.getSymbol(this.tradeInterface, this.segment, symbol);

          if (finalSymbol) {
            this.interactiveSocket?.send(
              this.createSignedRequest('spot.orders', 'subscribe', [finalSymbol.uniqueName])
            );
          }
        }
      };

      this.interactiveSocket.onclose = async () => {
        console.error(
          `${TradeInterface[this.tradeInterface]} interactive socket closed.`
        );
        clearInterval(this.pingPongIntervalInteractiveSocket);
        this.pingPongIntervalInteractiveSocket = undefined;
        setTimeout(() => {
          this.connectInteractiveSocket();
        }, 3000);
      };

      this.interactiveSocket.onerror = async (error) => {
        console.error(
          `${TradeInterface[this.tradeInterface]
          } interactive socket error: ${JSON.stringify(error)}`
        );
      };

      this.interactiveSocket.onmessage = async (message) => {
        if (message && message.data) {
          let messageData = JSON.parse(message.data);

          if (messageData && messageData.event === 'subscribe') {
            if (messageData.result && messageData.result.status == 'success') {
              console.info(`${TradeInterface[this.tradeInterface]} channel ${messageData.channel} subscribed successfully.\n${JSON.stringify(messageData.payload)}`);
            } else {
              console.error(`${TradeInterface[this.tradeInterface]} channel ${messageData.channel} subscription failed.\n${JSON.stringify(messageData.result)}`);
            }
          }

          if (messageData && messageData.event === 'update') {
            switch (messageData.channel) {
              case 'spot.balances':
                {
                  for (let index = 0; index < messageData.result.length; index++) {
                    let result = messageData.result[index];
                    let cryptoCoin = this.symbolManagerService.getCryptoCoin(
                      this.tradeInterface,
                      this.segment,
                      result.currency
                    );

                    if (cryptoCoin) {
                      let accountBalance = new AccountBalance(
                        cryptoCoin,
                        parseFloat(result.available),
                        parseFloat(result.freeze)
                      );

                      this.appService.appEvents.emit({
                        MessageType: MessageTypes.BALANCE_UPDATE_EVENT,
                        Data: accountBalance,
                      });
                    }
                  }
                }
                break;
              case 'spot.orders':
                {
                  for (let index = 0; index < messageData.result.length; index++) {
                    let result = messageData.result[index];
                    let symbol = this.symbolManagerService.getSymbol(this.tradeInterface, this.segment, result.currency_pair.replace('_', ''));
                    if (symbol) {

                      if (parseFloat(result.left) > 0 && parseFloat(result.left) < parseFloat(result.amount)) {
                        result.finish_as = 'PARTIALLY_FILLED';
                      }

                      let order = new Order(
                        symbol,
                        result.id,
                        this.convertToTransactionType(result.side),
                        this.convertToOrderType(result.type),
                        parseFloat(result.amount),
                        parseFloat(result.price),
                        parseFloat(result.amount) - parseFloat(result.left),
                        parseFloat(result.fill_price),
                        result.create_time_ms,
                        result.update_time_ms,
                        this.convertToOrderStatus(result.finish_as),
                        0,
                        result.text
                      );

                      this.appService.appEvents.emit({
                        MessageType: MessageTypes.ORDER_UPDATE_EVENT,
                        Data: order,
                      });

                      this.appService.appEvents.emit({
                        MessageType: MessageTypes.ORDER_PARTIAL_FILL_EVENT,
                        Data: order,
                      });
                    }
                  }
                }
                break;
            }
          }
        }
      };
    }
  }

  /**
   * Generates a signature for Gate.io API authentication.
   * @param channel The channel name.
   * @param event The event name.
   * @param timestamp The current Unix timestamp.
   * @returns An object containing the authentication details.
   */
  public generateSign(channel: string, event: string, timestamp: number): { method: string; KEY: string; SIGN: string } {
    const message = `channel=${channel}&event=${event}&time=${timestamp}`;

    const signature = HmacSHA512(message, this.apiSecret).toString(enc.Hex);

    return {
      method: 'api_key',
      KEY: this.apiKey,
      SIGN: signature
    };
  }


  /**
   * Creates a signed request object and returns it as a JSON string.
   * @param channel The channel for the request.
   * @param event The event for the request (e.g., 'subscribe' or 'unsubscribe').
   * @param payload The payload for the request.
   * @returns A JSON string representing the signed request.
   */
  public createSignedRequest(channel: string, event: string, payload: any): string {
    let timestamp = Math.floor(Date.now() / 1000);
    let id = Date.now() * 1000; // Equivalent to Python's int(time.time() * 1e6)

    let request: any = {
      id,
      time: timestamp,
      channel,
      event,
      auth: this.generateSign(channel, event, timestamp)
    };

    if (payload) {
      request.payload = payload;
    }

    return JSON.stringify(request);
  }

  async registerMarketDataEvents(marketDataSocket: WebSocket, symbol: string) {
    marketDataSocket.onopen = async () => {
      console.info(
        `${TradeInterface[this.tradeInterface]
        } ${symbol} marketData socket connected.`
      );

      if (!this.pingPongIntervalMarketDataSocket) {
        this.pingPongIntervalMarketDataSocket = setInterval(() => {
          marketDataSocket.send(JSON.stringify({ time: new Date().getTime(), channel: 'spot.ping' }));
        }, 30000);
      }

      for (let index = 0; index < this.symbols.length; index++) {
        let symbol = this.symbols[index];
        let finalSymbol = this.symbolManagerService.getSymbol(this.tradeInterface, this.segment, symbol);

        if (finalSymbol) {
          marketDataSocket.send(
            this.createSignedRequest('spot.order_book', 'subscribe', [
              finalSymbol.uniqueName,
              '20',
              '100ms'
            ])
          );
        }
      }
    };

    marketDataSocket.onclose = async () => {
      console.error(
        `${TradeInterface[this.tradeInterface]
        } ${symbol} marketData socket closed.`
      );

      clearInterval(this.pingPongIntervalMarketDataSocket);
      this.pingPongIntervalMarketDataSocket = undefined;

      setTimeout(() => {
        this.connectMarketDataSocket(symbol);
      }, 3000);
    };

    marketDataSocket.onmessage = async (message: any) => {
      try {
        if (message && message.data) {
          let messageData = JSON.parse(message.data);

          if (messageData && messageData.event === 'subscribe') {
            if (messageData.result && messageData.result.status == 'success') {
              console.info(`${TradeInterface[this.tradeInterface]} channel ${messageData.channel} subscribed successfully.\n${JSON.stringify(messageData.payload)}`);
            } else {
              console.error(`${TradeInterface[this.tradeInterface]} channel ${messageData.channel} subscription failed.\n${JSON.stringify(messageData.result)}`);
            }
          }

          if (messageData && messageData.event === 'update') {
            switch (messageData.channel) {
              case 'spot.order_book':
                {
                  let symbol = this.symbolManagerService.getSymbol(this.tradeInterface, this.segment, messageData.result.s.replace('_', ''));

                  if (symbol) {
                    let marketDepths = new MarketDepths(
                      symbol.token,
                      this.segment,
                      this.tradeInterface,
                      [],
                      []
                    );

                    if (messageData.result.bids) {
                      for (let index = 0; index < messageData.result.bids.length; index++) {
                        let bid = messageData.result.bids[index];
                        let marketDepthInfo = new MarketDepthInfo(parseFloat(bid[0]), parseFloat(bid[1]), 0);
                        marketDepths.bids.push(marketDepthInfo);
                      }
                    }

                    if (messageData.result.asks) {
                      for (let index = 0; index < messageData.result.asks.length; index++) {
                        let ask = messageData.result.asks[index];
                        let marketDepthInfo = new MarketDepthInfo(parseFloat(ask[0]), parseFloat(ask[1]), 0);
                        marketDepths.asks.push(marketDepthInfo);
                      }
                    }

                    this.appService.appEvents.emit({
                      MessageType: MessageTypes.MARKET_DEPTH_MESSAGE_EVENT,
                      Data: marketDepths,
                    });
                  }
                }
                break;
            }
          }
        }
      } catch (error) {
        console.error(
          `${TradeInterface[this.tradeInterface]
          } ${symbol} marketData socket text message error => ${(<Error>error).message
          }`
        );
      }
    };

    marketDataSocket.onerror = async (data) => {
      console.error(
        `${TradeInterface[this.tradeInterface]
        } ${symbol} marketData socket error: ${JSON.stringify(data)}`
      );
    };
  }

  async connectMarketDataSocket(symobl: string) {
    this.marketDataSocket = new WebSocket(`${this.socketUrl}`);
    this.registerMarketDataEvents(this.marketDataSocket, symobl);
    //let marketDataSocket = new WebSocket(`${this.socketUrl}`);
    // this.marketDataSockets.set(symobl, marketDataSocket);
    // this.registerMarketDataEvents(marketDataSocket, symobl);
  }

  convertToTransactionType(transactionType: string): TransactionType {
    if (!isNumber(transactionType)) {
      switch (transactionType.toUpperCase()) {
        case 'BUY':
          return TransactionType.Buy;
        case 'SELL':
          return TransactionType.Sell;
        default:
          return TransactionType.None;
      }
    } else {
      if (parseInt(transactionType) == 1) {
        return TransactionType.Buy;
      } else if (parseInt(transactionType) == 2) {
        return TransactionType.Sell;
      } else {
        return TransactionType.None;
      }
    }
  }

  convertToOrderStatus(orderStatus: string | number): OrderStatus {
    if (!isNumber(orderStatus)) {
      // orderStatus	open
      // orderStatus	filled
      // orderStatus	cancelled
      // orderStatus	liquidate_cancelled
      // orderStatus	depth_not_enough
      // orderStatus	trader_not_enough
      // orderStatus	small
      // orderStatus	ioc
      // orderStatus	poc
      // orderStatus	fok
      // orderStatus	stp
      // orderStatus	unknown

      switch (orderStatus.toUpperCase()) {
        case 'OPEN':
          return OrderStatus.New;
        case 'FILLED':
          return OrderStatus.Filled;
        case 'PARTIALLY_FILLED':
          return OrderStatus.PartiallyFilled;
        case 'CANCELED':
          return OrderStatus.Cancelled;
        case 'PARTIALLY_CANCELED':
          return OrderStatus.PartiallyCanceled;
        default:
          return OrderStatus.None;
      }
    } else {
      switch (orderStatus) {
        case 1:
          return OrderStatus.New;
        case 2:
          return OrderStatus.Filled;
        case 3:
          return OrderStatus.PartiallyFilled;
        case 4:
          return OrderStatus.Cancelled;
        case 5:
          return OrderStatus.PartiallyCanceled;
        default:
          return OrderStatus.None;
      }
    }
  }

  convertToOrderType(orderType: string): OrderType {
    if (!isNumber(orderType)) {
      // Order type
      // LIMIT (Limit order)
      // MARKET (Market order)
      // LIMIT_MAKER (Limit maker order)
      // IMMEDIATE_OR_CANCEL (Immediate or cancel order)
      // FILL_OR_KILL (Fill or kill order)

      switch (orderType.toUpperCase()) {
        case 'LIMIT':
          return OrderType.Limit;
        case 'MARKET':
        default:
          return OrderType.None;
      }
    } else {
      switch (parseInt(orderType)) {
        case 1:
          return OrderType.Limit;
        case 5:
          return OrderType.Market;
        default:
          return OrderType.None;
      }
    }
  }

  public async getOrdersBySymbol(symbol: string): Promise<IOrder[]> {
    try {
      // Get server time for signature
      const serverTime = await this.getServerTime();

      // Generate signature for the request
      const signature = this.getSignature({
        recvWindow: this.defaultRecvWindow,
        timestamp: serverTime,
        symbol: symbol
      });

      // Make the API call to fetch orders
      const response = await this.httpClient
        .get<any>(`${this.apiUrl}/api/v3/openOrders`, {
          headers: {
            'X-MBX-APIKEY': this.apiKey
          },
          params: {
            recvWindow: this.defaultRecvWindow,
            timestamp: serverTime,
            symbol: symbol,
            signature: signature
          }
        })
        .toPromise();

      if (!response || !Array.isArray(response)) {
        console.error(`Invalid response from ${TradeInterface[this.tradeInterface]} getOpenOrders:`, response);
        return [];
      }

      return response.map(order => {
        const symbolObj = this.symbolManagerService.getSymbol(
          this.tradeInterface,
          this.segment,
          order.symbol
        );

        if (!symbolObj) {
          console.error('Symbol not found:', order.symbol);
          return null;
        }

        return new Order(
          symbolObj,
          order.orderId,
          order.side === 'BUY' ? TransactionType.Buy : TransactionType.Sell,
          order.type === 'LIMIT' ? OrderType.Limit : OrderType.Market,
          parseFloat(order.origQty),
          parseFloat(order.price),
          parseFloat(order.executedQty),
          parseFloat(order.price), // Using price as averagePrice since it's not provided
          order.time,
          order.updateTime,
          this.mapOrderStatus(order.status),
          0, // otherQuantity
          order.clientOrderId
        );
      }).filter(order => order !== null) as IOrder[];
    } catch (error) {
      console.error(`Error fetching ${TradeInterface[this.tradeInterface]} orders:`, error);
      return [];
    }
  }

  private mapOrderStatus(status: string): OrderStatus {
    switch (status) {
      case 'OPEN':
        return OrderStatus.New;
      case 'PARTIALLY_FILLED':
        return OrderStatus.PartiallyFilled;
      case 'FILLED':
        return OrderStatus.Filled;
      case 'CANCELED':
        return OrderStatus.Cancelled;
      case 'REJECTED':
        return OrderStatus.Rejected;
      default:
        return OrderStatus.New; // Default to New for unknown statuses
    }
  }

  private extractMagicNumber(clientOrderId: string): number | undefined {
    if (!clientOrderId) return undefined;
    const match = clientOrderId.match(/MN(\d+)/);
    return match ? parseInt(match[1]) : undefined;
  }

  private async getServerTime(): Promise<number> {
    try {
      const response = await this.httpClient
        .get<any>(`${this.apiUrl}/api/v3/time`)
        .toPromise();
      return response.serverTime;
    } catch (error) {
      console.error('Error getting server time:', error);
      return Date.now();
    }
  }

  private getSignature(params: any): string {
    const queryString = Object.entries(params)
      .map(([key, value]) => `${key}=${value}`)
      .join('&');
    return HmacSHA512(queryString, this.apiSecret).toString(enc.Hex);
  }

  /**
   * Fetches all orders for a symbol within a given time range.
   * @param symbol The trading symbol (e.g., 'BTCUSDT')
   * @param startTime The start time in milliseconds since epoch.
   * @param limit Maximum number of orders to retrieve (default 500, max 1000).
   * @returns A promise resolving to an array of IOrder objects.
   */
  async getAllOrdersBySymbolAndTime(symbol: string, startTime: number, limit: number = 1000): Promise<IOrder[]> {
    try {
      this.logWithTimestamp(`${TradeInterface[this.tradeInterface]} Fetching all orders for ${symbol} starting from ${new Date(startTime).toISOString()}`);
      const timestamp = Date.now();
      const params: any = {
        symbol: symbol,
        startTime: startTime,
        limit: Math.min(limit, 1000), // Ensure limit doesn't exceed max
        recvWindow: this.defaultRecvWindow, // Explicitly use the default recvWindow
        timestamp: timestamp, // Use the current timestamp for the request
      };

      // Generate signature *after* all parameters, including recvWindow, are added
      const signature = this.getSignature(params);
      params['signature'] = signature; // Add signature to the params object

      const response = await this.httpClient
        .get<any[]>(`${this.apiUrl}/api/v3/allOrders`, {
          headers: { 'X-MEXC-APIKEY': this.apiKey },
          params: params, // Send the params object with explicit recvWindow and signature
        })
        .toPromise();

      if (!response || !Array.isArray(response)) {
        console.error(`${TradeInterface[this.tradeInterface]} Invalid response from getAllOrdersBySymbolAndTime for ${symbol}:`, response);
        return [];
      }

      this.logWithTimestamp(`${TradeInterface[this.tradeInterface]} Received ${response.length} orders from allOrders API for ${symbol}`);

      const orders: IOrder[] = response.map(orderData => {
        const symbolObj = this.symbolManagerService.getSymbol(
          this.tradeInterface,
          this.segment,
          orderData.symbol
        );

        if (!symbolObj) {
          console.error(`${TradeInterface[this.tradeInterface]} Symbol object not found for order: ${orderData.symbol}`);
          return null; // Skip if symbol info is missing
        }

        const filledQty = parseFloat(orderData.executedQty);
        const avgPrice = filledQty > 0 ? (parseFloat(orderData.cummulativeQuoteQty) / filledQty) : parseFloat(orderData.price);

        return new Order(
          symbolObj,
          orderData.orderId,
          orderData.side === 'BUY' ? TransactionType.Buy : TransactionType.Sell,
          this.mapOrderType(orderData.type),
          parseFloat(orderData.origQty),
          parseFloat(orderData.price),
          filledQty,
          avgPrice,
          orderData.time, // Creation time
          orderData.updateTime, // Last update time
          this.mapOrderStatus(orderData.status),
          0, // otherQuantity - Assuming not applicable
          orderData.clientOrderId // Include clientOrderId
        );
      }).filter(order => order !== null) as IOrder[]; // Filter out nulls

      return orders;

    } catch (error: any) {
      console.error(`${TradeInterface[this.tradeInterface]} Error fetching all orders for symbol ${symbol}:`, error);
      // Add specific logging for the recvWindow error
      if (error?.error?.msg?.includes('recvWindow')) {
        console.error(`${TradeInterface[this.tradeInterface]} Received recvWindow error. Current recvWindow setting: ${this.defaultRecvWindow}ms`);
      }
      return []; // Return empty array on error
    }
  }

  private mapOrderType(type: string): OrderType {
    switch (type) {
      case 'LIMIT':
        return OrderType.Limit;
      case 'MARKET':
        return OrderType.Market;
      case 'LIMIT_MAKER': // Common GateIO type
        return OrderType.LimitMaker;
      case 'IMMEDIATE_OR_CANCEL':
        return OrderType.ImmediateOrCancel;
      case 'FILL_OR_KILL':
        return OrderType.FillOrKill;
      default:
        console.warn(`${TradeInterface[this.tradeInterface]} Unknown order type received: ${type}`);
        return OrderType.None; // Or handle as appropriate
    }
  }

  private logWithTimestamp(message: string, data?: any): void {
    // Convert to Indian Standard Time (UTC+5:30)
    const date = new Date();
    // Add 5 hours and 30 minutes to UTC time to get IST
    const istTime = new Date(date.getTime() + (5 * 60 + 30) * 60000);
    const timestamp = istTime.toISOString().replace('Z', '+05:30');

    const formattedMessage = `[${timestamp}] ${message}`;

    if (data) {
      console.log(formattedMessage, data);
    } else {
      console.log(formattedMessage);
    }
  }
}
