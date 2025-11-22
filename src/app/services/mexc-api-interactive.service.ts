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
import { HmacSHA256, enc } from 'crypto-js';
import * as pako from 'pako';
import * as protobuf from 'protobufjs';
import { CryptoCoin } from '../models/crypto-coin';
import { SymbolCrypto } from '../models/symbol-crypto';
import { AccountBalance } from '../models/account-balance';
import { Order } from '../models/order';
import { ISymbol } from '../interfaces/symbol-interface';
import { MarketDepthInfo, MarketDepths } from '../models/market-depths';
import { isNumber } from 'lodash';
import { Subscription } from 'rxjs';
import { MessageDataInterface } from '../interfaces/message-data-interface';
import { LocalStorageService } from './local-storage.service';
import { MexcCredentials } from '../config/api-credentials';

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
export class MexcApiInteractiveService {
  private readonly apiUrl = 'https://api.mexc.com';
  private readonly apiKey = MexcCredentials.apiKey;
  private readonly apiSecret = MexcCredentials.apiSecret;
  private readonly defaultRecvWindow = 25000;
  tradeInterface: TradeInterface;
  segment: Segment;
  socketApiUrl: string;
  socketUrl: string;
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
  symbols: string[] = [
    'XDCUSDT',
    'SOLOUSDT',
    'COREUMUSDT',
    //'XLMUSDT',
    'QNTUSDT',
    'EWTUSDT',
    'XRPUSDT',
    'HBARUSDT',
  ];

  constructor(
    private httpClient: HttpClient,
    private symbolManagerService: SymbolManagerService,
    private appService: AppService,
    private localStorageService: LocalStorageService
  ) {
    this.tradeInterface = TradeInterface.MEXCApi;
    this.segment = Segment.MEXC;
    this.socketApiUrl = 'https://api.mexc.com';
    //this.socketUrl = 'wss://wbs.mexc.com/ws';
    this.socketUrl = 'wss://wbs-api.mexc.com/ws';
    this.openOrders = new Map<string, IOrder>();
    this.balances = new Map<string, IAccountBalance>();
    this.listernerKey = '';
    this.xrpUSDTWindow = null;
    this.placeOrderInProgress = false;
  }

  async init() {
    await this.getSymbols();
    await this.getBalance();
    //this.xrpUSDTWindow = window.open('https://www.mexc.com/exchange/XRP_USDT');

    //await this.getAllOpenOrders();

    // this.appService.appEvents.on(
    //   MessageTypes.GET_ALL_OPEN_ORDERS_EVENT,
    //   this.getAllOpenOrders.bind(this)
    // );

    // this.appService.appEvents.on(
    //   MessageTypes.GET_BALANCE_EVENT,
    //   this.getBalance.bind(this)
    // );

    // this.appService.appEvents.on(
    //   MessageTypes.CANCEL_ORDER_EVENT,
    //   this.cancelOrder.bind(this)
    // );

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
    }, 2000);

    setTimeout(() => {
      this.connectMarketDataSocket('')
    }, 5000);

    //this.connectInteractiveSocket();
    //this.connectMarketDataSocket('');
  }

  generateSignature(
    parameters: string,
    timestamp: string,
    contenType: string
  ): string {
    console.info(
      `sign string ${parameters ? parameters + '&' : ''}recvWindow=${this.defaultRecvWindow
      }&timestamp=${timestamp}`
    );

    let concatedString = `${parameters ? parameters + '&' : ''
      }timestamp=${timestamp}`;

    if (concatedString.includes('&network=')) {
      concatedString = concatedString.replace(/\(/g, '%28');
      concatedString = concatedString.replace(/\)/g, '%29');
    }
    return HmacSHA256(`${concatedString}`, this.apiSecret).toString(enc.Hex);
  }

  async http_request(
    endpoint: string,
    method: HTTPMethods,
    data: any,
    Info = '',
    contenType = 'application/json'
  ) {
    let httpParams: any = '';

    if (data) {
      httpParams = new HttpParams();
      for (let key in data) {
        if (data.hasOwnProperty(key)) {
          // let encodedValue =
          //   key == 'network'
          //     ? encodeURIComponent(data[key])
          //         .replace(/\(/g, '%28')
          //         .replace(/\)/g, '%29')
          //     : data[key];
          httpParams = httpParams.set(key, data[key]);
        }
      }

      console.info(`httpParams: ${httpParams.toString()}`);
    }

    try {
      let timestamp = new Date().getTime().toString();
      let sign = this.generateSignature(
        data ? httpParams : '',
        timestamp,
        contenType
      );
      let fullendpoint: string = this.apiUrl + endpoint;

      let headers: any = {
        'X-MEXC-APIKEY': this.apiKey,
      };

      if (method == HTTPMethods.POST || method == HTTPMethods.PUT) {
        headers['Content-Type'] = contenType;
      }

      let params: any = {};

      params = Object.assign(params, data);

      params.timestamp = timestamp;
      params.signature = sign;
      params = Object.assign(params, data);

      // if (params.network) {
      //   params.network = encodeURIComponent(params.network)
      //     .replace(/\(/g, '%28')
      //     .replace(/\)/g, '%29');
      // }

      switch (method) {
        case HTTPMethods.GET:
          return await this.httpClient
            .get<any>(`${fullendpoint}`, {
              headers: headers,
              params: params,
            })
            .toPromise();
        case HTTPMethods.POST:
          return await this.httpClient
            .post<any>(`${fullendpoint}`, null, {
              headers: headers,
              params: params,
            })
            .toPromise();
        case HTTPMethods.PUT:
          return await this.httpClient
            .put<any>(`${fullendpoint}`, null, {
              headers: headers,
              params: params,
            })
            .toPromise();
        case HTTPMethods.DELETE:
          return await this.httpClient
            .delete<any>(`${fullendpoint}`, {
              headers: headers,
              params: params,
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
        '/api/v3/capital/config/getall',
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

    // let coins = await this.http_request(
    //   '/api/v3/capital/config/getall',
    //   HTTPMethods.GET,
    //   null,
    //   'getCoins'
    // );

    if (coins && coins.length > 0) {
      // this.localStorageService.setItem(
      //   `${TradeInterface[this.tradeInterface]}-coins`,
      //   JSON.stringify(coins)
      // );

      for (let index = 0; index < coins.length; index++) {
        let coin = coins[index];

        let cryptoCoin = new CryptoCoin(
          this.tradeInterface,
          this.segment,
          coin.coin,
          coin.coin,
          true,
          true,
          0,
          0,
          0,
          coin.networkList
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
        '/api/v3/exchangeInfo',
        HTTPMethods.GET,
        null,
        'getSymbols'
      );

      if (result.symbols.length > 0) {
        symbols = result.symbols;
        this.localStorageService.setItem(
          `${TradeInterface[this.tradeInterface]}-symbols`,
          JSON.stringify(symbols)
        );
      }
    }

    // let symbol = {
    //   symbol: 'XDCUSDT',
    //   status: 'ENABLED',
    //   baseAsset: 'XDC',
    //   baseAssetPrecision: 2,
    //   quoteAsset: 'USDT',
    //   quotePrecision: 5,
    //   quoteAssetPrecision: 5,
    //   baseCommissionPrecision: 2,
    //   quoteCommissionPrecision: 5,
    //   orderTypes: ['LIMIT', 'MARKET', 'LIMIT_MAKER'],
    //   isSpotTradingAllowed: true,
    //   isMarginTradingAllowed: false,
    //   quoteAmountPrecision: '5.000000000000000000',
    //   baseSizePrecision: '0',
    //   permissions: ['SPOT'],
    //   filters: [],
    //   maxQuoteAmount: '2000000.000000000000000000',
    //   makerCommission: '0',
    //   takerCommission: '0',
    //   quoteAmountPrecisionMarket: '5.000000000000000000',
    //   maxQuoteAmountMarket: '100000.000000000000000000',
    //   fullName: 'XDC Network',
    // };

    if (symbols.length > 0) {
      for (let index = 0; index < symbols.length; index++) {
        let symbol = symbols[index];

        let symbolCrypto = new SymbolCrypto(
          this.tradeInterface,
          this.segment,
          symbol.symbol,
          SymbolType.CRYPTO,
          symbol.symbol,
          symbol.symbol,
          1 / Math.pow(10, parseFloat(symbol.baseAssetPrecision)),
          1 / Math.pow(10, parseFloat(symbol.quotePrecision)),
          symbol.quoteAssetPrecision,
          symbol.baseAsset,
          symbol.quoteAsset
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
    let account = await this.http_request(
      '/api/v3/account',
      HTTPMethods.GET,
      null,
      'getBalance'
    );

    // let account = {
    //     "makerCommission": 20,
    //     "takerCommission": 20,
    //     "buyerCommission": 0,
    //     "sellerCommission": 0,
    //     "canTrade": true,
    //     "canWithdraw": true,
    //     "canDeposit": true,
    //     "updateTime": null,
    //     "accountType": "SPOT",
    //     "balances": [{
    //         "asset": "NBNTEST",
    //         "free": "1111078",
    //         "locked": "33"
    //     }, {
    //         "asset": "MAIN",
    //         "free": "1020000",
    //         "locked": "0"
    //     }],
    //     "permissions": ["SPOT"]
    // }

    if (account && account.balances) {
      for (let index = 0; index < account.balances.length; index++) {
        let balance = account.balances[index];

        let cryptoCoin = this.symbolManagerService.getCryptoCoin(
          this.tradeInterface,
          this.segment,
          balance.asset
        );

        if (cryptoCoin) {
          let accountBalance = new AccountBalance(
            cryptoCoin,
            parseFloat(balance.free),
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
      '/api/v3/openOrders',
      HTTPMethods.GET,
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
          order.symbol
        );

        // let orders = [
        //   {
        //     symbol: 'LTCBTC',
        //     orderId: 1,
        //     orderListId: -1,
        //     clientOrderId: 'myOrder1',
        //     price: '0.1',
        //     origQty: '1.0',
        //     executedQty: '0.0',
        //     cummulativeQuoteQty: '0.0',
        //     status: 'NEW',
        //     timeInForce: 'GTC',
        //     type: 'LIMIT',
        //     side: 'BUY',
        //     stopPrice: '0.0',
        //     icebergQty: '0.0',
        //     time: 1499827319559,
        //     updateTime: 1499827319559,
        //     isWorking: true,
        //     origQuoteOrderQty: '0.000000',
        //   },
        // ];

        if (symbol) {
          let orderNew = new Order(
            symbol,
            order.orderId,
            this.convertToTransactionType(order.side),
            this.convertToOrderType(order.type),
            parseFloat(order.origQty),
            parseFloat(order.price),
            parseFloat(order.executedQty),
            parseFloat(order.price),
            order.time,
            order.updateTime,
            this.convertToOrderStatus(order.status),
            0,
            order.clientOrderId
          );

          this.appService.appEvents.emit({
            MessageType: MessageTypes.ORDER_UPDATE_EVENT,
            Data: orderNew,
          });
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
      '/api/v3/order',
      HTTPMethods.DELETE,
      {
        symbol: order.symbol.name,
        orderId: order.orderId,
      },
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
      // Try web UI placement if requested
      if (placeOrderViaWeb && symbol.tradeInterface == TradeInterface.MEXCApi) {
        try {
          await this.httpClient
            .get<any>(`http://192.168.1.16:4000/orders/from/ui`, {
              headers: {},
              params: {
                symbol: symbol.token,
                transactionType: TransactionType[transactionType].toUpperCase(),
                orderType: OrderType[orderType].toUpperCase(),
                orderQuantity: orderQuantity,
                orderPrice: orderPrice,
              },
            })
            .toPromise();
          console.log(`Web UI order placement attempted for ${symbol.token}`);
        } catch (webError) {
          console.error(`Web UI order placement failed: ${webError}`);
        }
      }

      let orderDetails: any = {
        symbol: symbol.token,
        side: TransactionType[transactionType].toUpperCase(),
        type: OrderType[orderType].toUpperCase(),
        quantity: orderQuantity,
        price: orderPrice,
      }

      if (magicNumber) {
        orderDetails.newClientOrderId = magicNumber;
      }

      // Always attempt API order placement
      let placeOrderResponse = await this.http_request(
        '/api/v3/order',
        HTTPMethods.POST,
        orderDetails,
        'placeOrder'
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
      //coin=EOS&address=zzqqqqqqqqqq&amount=10&network=EOS&memo=MX10086&timestamp={{timestamp}}&signature={{signature}}
      let withdrawDetails: any = {
        coin: symbol,
        address: withdrawAddress,
        amount: amount.toString(),
        network: chainName,
      };

      if (memo) {
        withdrawDetails.memo = memo;
      }

      let withdrawCoinResponse = await this.http_request(
        '/api/v3/capital/withdraw/apply',
        HTTPMethods.POST,
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
   * Gets a specific order by symbol and magic number (client order ID) from MEXC API
   * @param symbol Trading symbol
   * @param magicNumber Magic number (client order ID)
   * @returns Array containing the order if found, otherwise empty array
   */
  async getOrdersByMagicNumber(symbol: string, magicNumber: string): Promise<IOrder[]> {
    try {
      // Use the /api/v3/order endpoint to query by clientOrderId
      const orderResponse = await this.http_request(
        '/api/v3/order', // Correct endpoint
        HTTPMethods.GET,
        {
          symbol: symbol,
          origClientOrderId: magicNumber // Query parameter for clientOrderId
        },
        'getOrdersByMagicNumber' // Updated function name for logging clarity
      );

      const orders: IOrder[] = [];

      // Check if the response is valid and represents a single order object
      if (orderResponse && typeof orderResponse === 'object' && orderResponse.orderId) {
        const order = orderResponse; // Response should be the single order details
        const symbolObj = this.symbolManagerService.getSymbol(
          this.tradeInterface,
          this.segment,
          order.symbol
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

  async createListenerKey() {
    try {
      let listenerKeyResponse = await this.http_request(
        '/api/v3/userDataStream',
        HTTPMethods.POST,
        null,
        'createListenerKey'
      );
      // let listenerKeyResponse = await this.httpClient
      //   .post<any>(`${this.socketApiUrl}/api/v3/userDataStream`, null, {
      //     headers: {
      //       'X-MEXC-APIKEY': this.apiKey,
      //     },
      //   })
      //   .toPromise();

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
    await this.createListenerKey();

    this.interactiveSocket = new WebSocket(
      `${this.socketUrl}?listenKey=${this.listernerKey}`
    );

    this.registerInteractiveEvents();
  }

  async registerInteractiveEvents() {
    if (this.interactiveSocket) {
      this.interactiveSocket.onopen = async () => {
        console.info(
          `${TradeInterface[this.tradeInterface]} interactive socket connected.`
        );

        this.interactiveSocket?.send(
          JSON.stringify({
            method: 'SUBSCRIPTION',
            params: ['spot@private.account.v3.api.pb'],
          })
        );

        this.interactiveSocket?.send(
          JSON.stringify({
            method: 'SUBSCRIPTION',
            params: ['spot@private.orders.v3.api.pb'],
          })
        );

        this.startHeartbeat();
        this.startListenerKeyExtension();
      };

      this.interactiveSocket.onclose = async () => {
        console.error(
          `${TradeInterface[this.tradeInterface]} interactive socket closed.`
        );
        this.stopHeartbeat();
        this.stopListenerKeyExtension();
        await this.connectInteractiveSocket();
      };

      this.interactiveSocket.onerror = async (error) => {
        console.error(
          `${TradeInterface[this.tradeInterface]
          } interactive socket error: ${JSON.stringify(error)}`
        );
      };

      this.interactiveSocket.onmessage = async (message) => {
        if (message.data instanceof Blob || message.data instanceof ArrayBuffer) {
          {
            const buffer =
              message.data instanceof Blob
                ? await message.data.arrayBuffer()
                : message.data;

            let dataToDecode: Uint8Array = new Uint8Array(buffer);

            // 1. Decode the outer message with the correct schema
            const decodedOrder: any = PrivateOrdersV3ApiBaseMessage.decode(dataToDecode);

            if (decodedOrder.channel === 'spot@private.orders.v3.api.pb') {
              // 2. Check if the inner data payload exists
              if (!decodedOrder.data || decodedOrder.data.length === 0) {
                console.warn('Received a message without a order data payload, ignoring.');
                return;
              }

              const decodedOrderData: any = PrivateOrdersV3Api.decode(decodedOrder.data);

              // 4. Map to our Order object
              let symbol = this.symbolManagerService.getSymbol(
                this.tradeInterface,
                this.segment,
                decodedOrder.symbol
              );

              if (symbol) {
                const order = new Order(
                  symbol,
                  decodedOrderData.orderId,
                  this.convertToTransactionType(decodedOrderData.tradeType),
                  this.convertToOrderType(decodedOrderData.orderType),
                  parseFloat(decodedOrderData.orderQuantity),
                  parseFloat(decodedOrderData.orderPrice),
                  parseFloat(decodedOrderData.orderQuantity) - parseFloat(decodedOrderData.remainQuantity), // Calculated executedQty
                  parseFloat(decodedOrderData.avgPrice), // Avg price, placeholder
                  decodedOrderData.createTime,
                  decodedOrder.updateTime,
                  this.convertToOrderStatus(decodedOrderData.orderStatus),
                  0,
                  decodedOrderData.clientOrderId
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

            if (decodedOrder.channel === 'spot@private.account.v3.api.pb') {
              let dataToDecode: Uint8Array = new Uint8Array(buffer);
              const decodedAccount: any = PrivateAccountV3ApiBaseMessage.decode(dataToDecode);

              // 2. Check if the inner data payload exists
              if (!decodedAccount.data || decodedAccount.data.length === 0) {
                console.warn('Received a message without a account data payload, ignoring.');
                return;
              }

              const decodedAccountData: any = PrivateAccountV3Api.decode(decodedAccount.data);

              let cryptoCoin = this.symbolManagerService.getCryptoCoin(
                this.tradeInterface,
                this.segment,
                decodedAccountData.coinName
              );

              if (cryptoCoin) {
                let accountBalance = new AccountBalance(
                  cryptoCoin,
                  parseFloat(decodedAccountData.balanceAmount),
                  parseFloat(decodedAccountData.frozenAmount)
                );

                // console.info(
                //   `${TradeInterface[this.tradeInterface]} Balance Update Event: ${JSON.stringify(accountBalance)}`
                // );

                this.appService.appEvents.emit({
                  MessageType: MessageTypes.BALANCE_UPDATE_EVENT,
                  Data: accountBalance,
                });
              }
            }
          }
        }
        else {
          try {
            let data = JSON.parse(message.data);

            // Handle PONG response
            if (data.result === 'pong') {
              console.info(`${TradeInterface[this.tradeInterface]} interactive socket pong received.`);
            }

            switch (data.c) {
              case 'spot@private.account.v3.api':
                {
                  let cryptoCoin = this.symbolManagerService.getCryptoCoin(
                    this.tradeInterface,
                    this.segment,
                    data.d.a
                  );

                  if (cryptoCoin) {
                    let accountBalance = new AccountBalance(
                      cryptoCoin,
                      parseFloat(data.d.f),
                      parseFloat(data.d.l)
                    );

                    // console.info(
                    //   `${TradeInterface[this.tradeInterface]} Balance Update Event: ${JSON.stringify(accountBalance)}`
                    // );

                    this.appService.appEvents.emit({
                      MessageType: MessageTypes.BALANCE_UPDATE_EVENT,
                      Data: accountBalance,
                    });
                  }
                }
                break;
              case 'spot@private.orders.v3.api':
                {
                  let symbol = this.symbolManagerService.getSymbol(
                    this.tradeInterface,
                    this.segment,
                    data.s
                  );

                  if (symbol) {
                    let order = new Order(
                      symbol,
                      data.d.i,
                      this.convertToTransactionType(data.d.S),
                      this.convertToOrderType(data.d.o),
                      parseFloat(data.d.v),
                      parseFloat(data.d.p),
                      parseFloat(data.d.v) - parseFloat(data.d.V),
                      parseFloat(data.d.p),
                      data.d.O,
                      data.d.O,
                      this.convertToOrderStatus(data.d.s),
                      0,
                      data.d.c
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
                break;
            }
          } catch (error: any) {
            console.error(
              'Error in interactive socket for message update -> ' +
              error.toString()
            );
          }
        }
      };
    }
  }

  async registerMarketDataEvents(marketDataSocket: WebSocket, symbol: string) {
    marketDataSocket.onopen = async () => {
      console.info(
        `${TradeInterface[this.tradeInterface]
        } ${symbol} marketData socket connected.`
      );

      for (let index = 0; index < this.symbols.length; index++) {
        let symbol = this.symbols[index];

        await this.wait(1);

        marketDataSocket.send(
          JSON.stringify({
            method: 'SUBSCRIPTION',
            //params: [`spot@public.deals.v3.api@BTCUSDT`],
            //params: [`spot@public.deals.v3.api@${symbol}`],
            //params: [`spot@public.limit.depth.v3.api@${symbol}@20`],
            params: [`spot@public.limit.depth.v3.api.pb@${symbol}@5`],
          })
        );
      }
    };

    marketDataSocket.onclose = async () => {
      console.error(
        `${TradeInterface[this.tradeInterface]
        } ${symbol} marketData socket closed.`
      );

      setTimeout(() => {
        this.connectMarketDataSocket(symbol);
      }, 3000);
    };

    marketDataSocket.onmessage = async (message: any) => {
      if (message.data instanceof Blob || message.data instanceof ArrayBuffer) {
        try {
          const buffer =
            message.data instanceof Blob
              ? await message.data.arrayBuffer()
              : message.data;

          let dataToDecode: Uint8Array = new Uint8Array(buffer);

          // 1. Decode the outer message with the correct schema
          const wrapper: any = StreamWrapper.decode(dataToDecode);

          // 2. Check if the inner data payload exists
          if (!wrapper.data || wrapper.data.length === 0) {
            console.warn('Received a message without a data payload, ignoring.');
            return;
          }

          // 3. Decode the inner 'data' bytes to get the depth information
          const depthData: any = PublicLimitDepthsData.decode(wrapper.data);

          let symbol = this.symbolManagerService.getSymbol(
            this.tradeInterface,
            this.segment,
            wrapper.symbol.toUpperCase()
          );

          if (symbol) {
            let marketDepths = new MarketDepths(
              wrapper.symbol.toUpperCase(),
              this.segment,
              this.tradeInterface,
              [],
              []
            );

            if (depthData.asks) {
              for (let index = 0; index < depthData.asks.length; index++) {
                let ask = depthData.asks[index];
                let marketDepthInfo = new MarketDepthInfo(
                  parseFloat(ask.price),
                  parseFloat(ask.quantity),
                  0
                );
                marketDepths.asks.push(marketDepthInfo);
              }
            }

            if (depthData.bids) {
              for (let index = 0; index < depthData.bids.length; index++) {
                let bid = depthData.bids[index];
                let marketDepthInfo = new MarketDepthInfo(
                  parseFloat(bid.price),
                  parseFloat(bid.quantity),
                  0
                );
                marketDepths.bids.push(marketDepthInfo);
              }
            }

            this.appService.appEvents.emit({
              MessageType: MessageTypes.MARKET_DEPTH_MESSAGE_EVENT,
              Data: marketDepths,
            });
          }
        } catch (error: any) {
          console.error(
            `${TradeInterface[this.tradeInterface]
            } ${symbol} marketData socket binary message error => ${(<Error>error).message
            }`
          );
        }
      } else {
        try {
          const data = JSON.parse(message.data);

          if (data.ping) {
            marketDataSocket.send(JSON.stringify({ pong: data.ping }));
            return;
          }

          if (data.c && data.c.startsWith('spot@public.limit.depth.v3.api@')) {
            let symbol = this.symbolManagerService.getSymbol(
              this.tradeInterface,
              this.segment,
              data.s.toUpperCase()
            );

            if (symbol) {
              let marketDepths = new MarketDepths(
                data.s.toUpperCase(),
                this.segment,
                this.tradeInterface,
                [],
                []
              );

              for (let index = 0; index < data.d.asks.length; index++) {
                let ask = data.d.asks[index];
                let marketDepthInfo = new MarketDepthInfo(
                  parseFloat(ask.p),
                  parseFloat(ask.v),
                  0
                );
                marketDepths.asks.push(marketDepthInfo);
              }

              for (let index = 0; index < data.d.bids.length; index++) {
                let bid = data.d.bids[index];
                let marketDepthInfo = new MarketDepthInfo(
                  parseFloat(bid.p),
                  parseFloat(bid.v),
                  0
                );
                marketDepths.bids.push(marketDepthInfo);
              }

              this.appService.appEvents.emit({
                MessageType: MessageTypes.MARKET_DEPTH_MESSAGE_EVENT,
                Data: marketDepths,
              });
            }
          } else {
            console.info(
              `${TradeInterface[this.tradeInterface]
              } marketData socket text message:`,
              data
            );
          }
        } catch (error) {
          console.error(
            `${TradeInterface[this.tradeInterface]
            } ${symbol} marketData socket text message error => ${(<Error>error).message
            }`
          );
        }
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
      // Order Status
      // NEW Uncompleted
      // FILLED Filled
      // PARTIALLY_FILLED Partially filled
      // CANCELED Canceled
      // PARTIALLY_CANCELED Partially canceled

      switch (orderStatus) {
        case 'NEW':
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

      switch (orderType) {
        case 'LIMIT':
          return OrderType.Limit;
        case 'MARKET':
          return OrderType.Market;
        case 'LIMIT_MAKER':
          return OrderType.LimitMaker;
        case 'IMMEDIATE_OR_CANCEL':
          return OrderType.IOC;
        default:
          return OrderType.None;
      }
    } else {
      switch (parseInt(orderType)) {
        case 1:
          return OrderType.Limit;
        case 5:
          return OrderType.Market;
        case 3:
          return OrderType.IOC;
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
        console.error('Invalid response from MEXC getOpenOrders:', response);
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
      console.error('Error fetching MEXC orders:', error);
      return [];
    }
  }

  private mapOrderStatus(status: string): OrderStatus {
    switch (status) {
      case 'NEW':
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
    return HmacSHA256(queryString, this.apiSecret).toString(enc.Hex);
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
      this.logWithTimestamp(`[MEXC] Fetching all orders for ${symbol} starting from ${new Date(startTime).toISOString()}`);
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
        console.error(`[MEXC] Invalid response from getAllOrdersBySymbolAndTime for ${symbol}:`, response);
        return [];
      }

      this.logWithTimestamp(`[MEXC] Received ${response.length} orders from allOrders API for ${symbol}`);

      const orders: IOrder[] = response.map(orderData => {
        const symbolObj = this.symbolManagerService.getSymbol(
          this.tradeInterface,
          this.segment,
          orderData.symbol
        );

        if (!symbolObj) {
          console.error(`[MEXC] Symbol object not found for order: ${orderData.symbol}`);
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
      console.error(`[MEXC] Error fetching all orders for symbol ${symbol}:`, error);
      // Add specific logging for the recvWindow error
      if (error?.error?.msg?.includes('recvWindow')) {
        console.error(`[MEXC] Received recvWindow error. Current recvWindow setting: ${this.defaultRecvWindow}ms`);
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
      case 'LIMIT_MAKER': // Common MEXC type
        return OrderType.LimitMaker;
      case 'IMMEDIATE_OR_CANCEL':
        return OrderType.ImmediateOrCancel;
      case 'FILL_OR_KILL':
        return OrderType.FillOrKill;
      default:
        console.warn(`[MEXC] Unknown order type received: ${type}`);
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
