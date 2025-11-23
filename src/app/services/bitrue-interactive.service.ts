import { Injectable } from '@angular/core';
import * as pako from 'pako';
import { IInteractiveEngine } from '../interfaces/interactive';
import { BitrueCredentials, BitrueWithdrawCredentials } from '../config/api-credentials';
import {
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
import { IAccountBalance } from '../interfaces/account-balance-interface';
import { IOrder } from '../interfaces/order-interface';
import { HttpClient } from '@angular/common/http';
import { SymbolManagerService } from './symbol-manager.service';
import { AppService } from './app.service';
import { MarketDataService } from './market-data.service';
import { from } from 'linq';
import { AccountBalance } from '../models/account-balance';
import { Order } from '../models/order';
import { CryptoCoin } from '../models/crypto-coin';
import { SymbolCrypto } from '../models/symbol-crypto';
import { ISymbol } from '../interfaces/symbol-interface';
import { BaseResponse } from '../models/base-response';
import { environment } from '../../environments/environment.prod';
import { MarketDepthInfo, MarketDepths } from '../models/market-depths';
import { HmacSHA256, enc } from 'crypto-js';
import { Subscription } from 'rxjs';
import { MessageDataInterface } from '../interfaces/message-data-interface';
import { LocalStorageService } from './local-storage.service';

interface BiTruesymbolInfo {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  baseAssetPrecision: number;
  quotePrecision: number;
  filters: PriceFilter[];
}

interface PriceFilter {
  filterType: string;
  minPrice: number;
  maxPrice: number;
  priceScale: number;
  minQty: number;
  minVal: number;
  maxQty: number;
  volumeScale: number;
}

@Injectable({
  providedIn: 'root',
})
export class BitrueInteractiveService implements IInteractiveEngine {
  tradeInterface: TradeInterface;
  segment: Segment;
  apiUrl: string;
  socketApiUrl: string;
  socketUrl: string;
  socketMarketDataUrl: string;
  apiKey: string;
  apiSecret: string;
  withdrawApiKey: string;
  withdrawApiSecret: string;
  openOrders: Map<string, IOrder>;
  balances: Map<string, IAccountBalance>;
  listernerKey: string;
  defaultRecvWindow = 20000;
  isPongTimerInitialized = false;
  interactiveSocket: WebSocket | undefined;
  marketDataSockets: Map<string, WebSocket> = new Map<string, WebSocket>();
  appSubscription: Subscription | undefined;
  symbols: string[] = [
    //'XRPUSDT',
    //'SOLOUSDT',
    // 'ELSUSDT',
    // 'ELSXRP',
    // 'RPRUSDT',
    //'COREUMUSDT',
    // 'XCOREUSDT',
    'QNTUSDT',
    // 'QNTXRP',
    'XDCUSDT',
    //'XDCXRP',
    //'XLMUSDT',
    // 'XLMXRP',
    //'EWTUSDT',
    //'HBARUSDT',
  ];

  constructor(
    private httpClient: HttpClient,
    private symbolManagerService: SymbolManagerService,
    private appService: AppService,
    private markerDataService: MarketDataService,
    private localStorageService: LocalStorageService
  ) {
    this.tradeInterface = TradeInterface.BiTrueApi;
    this.segment = Segment.BiTrue;
    this.apiUrl = 'https://openapi.bitrue.com/api';
    this.socketApiUrl = 'https://open.bitrue.com';
    this.socketUrl = 'wss://wsapi.bitrue.com';
    this.socketMarketDataUrl = 'wss://ws.bitrue.com/kline-api/ws';
    this.apiKey = BitrueCredentials.apiKey;
    this.apiSecret = BitrueCredentials.apiSecret;
    this.withdrawApiKey = BitrueWithdrawCredentials.apiKey;
    this.withdrawApiSecret = BitrueWithdrawCredentials.apiSecret;
    this.openOrders = new Map<string, IOrder>();
    this.balances = new Map<string, IAccountBalance>();
    this.listernerKey = '';
  }

  async init() {
    await this.getSymbols();
    await this.getBalance();
    await this.getAllOpenOrders();

    this.appSubscription = this.appService.appEvents.subscribe(
      (message: MessageDataInterface<any>) => {
        // Handle different types of messages
        switch (message.MessageType) {
          case MessageTypes.GET_ALL_OPEN_ORDERS_EVENT:
            this.getAllOpenOrders.bind(this)();
            break;
          case MessageTypes.GET_BALANCE_EVENT:
            this.getBalance.bind(this)();
            break;
          case MessageTypes.CANCEL_ORDER_EVENT:
            this.cancelOrder.bind(this)(message.Data as IOrder);
            break;
        }
      }
    );

    this.connectInteractiveSocket();

    // for (let index = 0; index < this.symbols.length; index++) {
    //   let symbol = this.symbols[index];
    //   this.connectMarketDataSocket(symbol);
    // }

    this.connectMarketDataSocket('');
  }

  async getServerTime(): Promise<number> {
    try {
      let result = await this.httpClient
        .get<any>(`${this.apiUrl}/v1/time`, {
          headers: {
            //origin: 'http://192.168.1.16:4204',
            //referer: 'http://192.168.1.16:4204',
            //origin: `http://192.168.1.6:4200`,
            //referer: 'http://192.168.1.6:4200',
            //origin: 'https://openapi.bitrue.com',
            //'X-MBX-APIKEY': this.apiKey,
          },
          params: {
            recvWindow: this.defaultRecvWindow.toString(),
            timestamp: new Date().getTime().toString(),
          },
        })
        .toPromise();

      return <number>result.serverTime;
    } catch (error: any) {
      console.error(
        `Unalbe to get BitrueInteractive server time, reason: ${error.message}`
      );
    }

    return 0;
  }

  getSignature(params: any, apiSecret: string = this.apiSecret) {
    let query = '';

    from(params)
      .select((param) => {
        query =
          query == ''
            ? `${param.key}=${param.value}`
            : `${query}&${param.key}=${param.value}`;
        return param;
      })
      .toArray();

    return HmacSHA256(query, apiSecret).toString(enc.Hex);
  }

  async createListenerKey() {
    try {
      let listenerKeyResponse = await this.httpClient
        .post<any>(`${this.socketApiUrl}/poseidon/api/v1/listenKey`, null, {
          headers: {
            'X-MBX-APIKEY': this.apiKey,
          },
        })
        .toPromise();

      if (
        listenerKeyResponse &&
        listenerKeyResponse.data &&
        listenerKeyResponse.data.listenKey
      ) {
        this.listernerKey = listenerKeyResponse.data.listenKey;
        this.extendListenerKeyValidity();
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
        let listenerKeyResponse = await this.httpClient
          .put<any>(
            `${this.socketApiUrl}/poseidon/api/v1/listenKey/${this.listernerKey}`,
            null,
            {
              headers: {
                'X-MBX-APIKEY': this.apiKey,
              },
            }
          )
          .toPromise();
      } catch (error: any) {
        console.error(
          `Unable to externd listener key ${this.listernerKey
          } for ${this.tradeInterface.toString()} interactive socket. Reason: ${error.message
          }`
        );
      }
    }, 300000);
  }

  async getBalance() {
    try {
      let serverTime = await this.getServerTime();

      let signature = this.getSignature({
        recvWindow: this.defaultRecvWindow,
        timestamp: serverTime,
      });

      let getBalanceResponse = await this.httpClient
        .get<any>(`${this.apiUrl}/v1/account`, {
          headers: {
            'X-MBX-APIKEY': this.apiKey,
          },
          params: {
            recvWindow: this.defaultRecvWindow,
            timestamp: serverTime,
            signature: signature,
          },
        })
        .toPromise();

      if (
        getBalanceResponse &&
        getBalanceResponse.balances &&
        getBalanceResponse.balances.length > 0
      ) {
        for (
          let index = 0;
          index < getBalanceResponse.balances.length;
          index++
        ) {
          let balance = getBalanceResponse.balances[index];
          let cryptoCoin = this.symbolManagerService.getCryptoCoin(
            this.tradeInterface,
            this.segment,
            balance.asset.toUpperCase()
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

      return this.balances;
    } catch (error: unknown) {
      console.error(
        `Unalbe to get BitrueInteractive account balance, reason: ${(<Error>error).message
        }`
      );
    }

    return new Map<string, AccountBalance>();
  }

  async getAllOpenOrders() {
    try {
      for (let index = 0; index < this.symbols.length; index++) {
        let symbol = this.symbolManagerService.getSymbol(
          this.tradeInterface,
          this.segment,
          this.symbols[index]
        );

        if (symbol) {
          let serverTime = await this.getServerTime();
          let signature = this.getSignature({
            recvWindow: this.defaultRecvWindow,
            timestamp: serverTime,
            symbol: symbol.token,
          });

          let openOrders = await this.httpClient
            .get<any>(`${this.apiUrl}/v1/openOrders`, {
              headers: {
                'X-MBX-APIKEY': this.apiKey,
              },
              params: {
                recvWindow: this.defaultRecvWindow,
                timestamp: serverTime,
                symbol: symbol.token,
                signature: signature,
              },
            })
            .toPromise();

          // let openOrders = [
          //   {
          //     symbol: 'ELSUSDT',
          //     orderId: '518909087576326146',
          //     clientOrderId: '',
          //     price: '0.0300000000000000',
          //     origQty: '10000.0000000000000000',
          //     executedQty: '0',
          //     cummulativeQuoteQty: '0',
          //     status: 'NEW',
          //     timeInForce: '',
          //     type: 'LIMIT',
          //     side: 'SELL',
          //     stopPrice: '',
          //     icebergQty: '',
          //     time: 1709449106700,
          //     updateTime: 1709449106708,
          //     isWorking: false,
          //   },
          // ];

          if (openOrders && openOrders.length > 0) {
            for (let i = 0; i < openOrders.length; i++) {
              let openOrder = openOrders[i];
              let symbol = this.symbolManagerService.getSymbol(
                this.tradeInterface,
                this.segment,
                openOrder.symbol
              );

              if (symbol) {
                let order = new Order(
                  symbol,
                  openOrder.orderId,
                  this.convertToTransactionType(openOrder.side),
                  this.convertToOrderType(openOrder.type),
                  parseFloat(openOrder.origQty),
                  parseFloat(openOrder.price),
                  parseFloat(openOrder.executedQty),
                  parseFloat(openOrder.cummulativeQuoteQty),
                  parseFloat(openOrder.time),
                  parseFloat(openOrder.updateTime),
                  isNaN(openOrder.status)
                    ? this.convertToOrderStatusByString(openOrder.status)
                    : this.convertToOrderStatus(openOrder.status),
                  0,
                  openOrder.clientOrderId
                );

                this.appService.appEvents.emit({
                  MessageType: MessageTypes.ORDER_UPDATE_EVENT,
                  Data: order,
                });
              }
            }
          }
        }
      }
    } catch (error) {
      console.error(
        `Unalbe to get ${this.tradeInterface.toString()} all open orders, reason: ${(<Error>error).message
        }`
      );
    }
  }

  async getSymbols() {
    try {
      let storedCoinsAndSymbols = await this.localStorageService.getItem(
        `${TradeInterface[this.tradeInterface]}-coins-symbols`
      );

      let getSymbolResponse = null;

      if (storedCoinsAndSymbols) {
        getSymbolResponse = JSON.parse(storedCoinsAndSymbols);
      } else {
        let serverTime = await this.getServerTime();

        let signature = this.getSignature({
          recvWindow: this.defaultRecvWindow,
          timestamp: serverTime,
        });

        getSymbolResponse = await this.httpClient
          .get<any>(`${this.apiUrl}/v1/exchangeInfo`, {
            headers: {
              'X-MBX-APIKEY': this.apiKey,
            },
            params: {
              recvWindow: this.defaultRecvWindow,
              timestamp: serverTime,
              signature: signature,
            },
          })
          .toPromise();

        if (
          getSymbolResponse &&
          getSymbolResponse.coins &&
          getSymbolResponse.coins.length > 0
        ) {
          this.localStorageService.setItem(
            `${TradeInterface[this.tradeInterface]}-coins-symbols`,
            JSON.stringify(getSymbolResponse)
          );
        }
      }

      if (
        getSymbolResponse &&
        getSymbolResponse.coins &&
        getSymbolResponse.coins.length > 0
      ) {
        let coins = getSymbolResponse.coins;

        for (let index = 0; index < coins.length; index++) {
          let coin = coins[index];

          let cryptoCoin = new CryptoCoin(
            this.tradeInterface,
            this.segment,
            coin.coin.toUpperCase(),
            coin.coinFulName.toUpperCase(),
            true,
            true,
            0,
            0,
            0,
            coin.chains
          );

          this.symbolManagerService.setCryptoCoin(cryptoCoin);
        }

        if (getSymbolResponse.symbols && getSymbolResponse.symbols.length > 0) {
          let symbols = getSymbolResponse.symbols;

          for (let index = 0; index < symbols.length; index++) {
            let symbol = symbols[index];

            let cryptoCoin = this.symbolManagerService.getCryptoCoin(
              this.tradeInterface,
              this.segment,
              symbol.baseAsset.toUpperCase()
            );

            // let priceFilters = [
            //   {
            //     filterType: 'PRICE_FILTER',
            //     minPrice: '0.0003238',
            //     maxPrice: '0.0323800',
            //     tickSize: '0.000001',
            //     priceScale: 6,
            //   },
            //   {
            //     filterType: 'PERCENT_PRICE_BY_SIDE',
            //     bidMultiplierUp: '2.0',
            //     bidMultiplierDown: '0.1',
            //     askMultiplierUp: '10.0',
            //     askMultiplierDown: '0.7',
            //     avgPriceMins: '1',
            //   },
            //   {
            //     filterType: 'LOT_SIZE',
            //     minQty: '200.06',
            //     minVal: '10.0',
            //     maxQty: '9999999999999',
            //     stepSize: '0.01',
            //     volumeScale: 2,
            //   },
            // ];

            if (cryptoCoin) {
              if (symbol.symbol.toUpperCase() == 'QNTUSDT') {
                symbol.filters[2].stepSize = 0.01;
              }

              let symbolCrypto = new SymbolCrypto(
                this.tradeInterface,
                this.segment,
                symbol.symbol.toUpperCase(),
                SymbolType.CRYPTO,
                symbol.symbol.toUpperCase(),
                symbol.symbol.toUpperCase(),
                parseFloat(symbol.filters[2].stepSize),
                parseFloat(symbol.filters[0].tickSize),
                parseFloat(symbol.filters[0].priceScale),
                symbol.baseAsset.toUpperCase(),
                symbol.quoteAsset.toUpperCase()
              );

              this.symbolManagerService.setSymbol(symbolCrypto);
            }
          }

          console.log(
            `${TradeInterface[this.tradeInterface]} Total coins fetched: ${getSymbolResponse.coins.length
            }`
          );

          console.log(
            `${TradeInterface[this.tradeInterface]} Total symbols fetched: ${getSymbolResponse.symbols.length
            }`
          );
        }
      }

      return;
    } catch (error) {
      console.error(
        `Unalbe to get BitrueInteractive account balance, reason: ${(<Error>error).message
        }`
      );
    }

    return [];
    // try {
    //   let getSymbolsResponse = await this.httpClient
    //     .get<BaseResponse<ISymbol[]>>(`${environment.apiUrl}/symbols`)
    //     .toPromise();

    //   if (!getSymbolsResponse.error) {
    //     if (getSymbolsResponse.data && getSymbolsResponse.data.length > 0) {
    //       for (const symbol of getSymbolsResponse.data.values()) {
    //         if (symbol.type == SymbolType.CRYPTO) {
    //           this.symbolManagerService.setSymbol(
    //             new SymbolCrypto(
    //               symbol.tradeInterface,
    //               symbol.segment,
    //               symbol.token,
    //               symbol.type,
    //               symbol.name,
    //               symbol.uniqueName,
    //               symbol.lotSize,
    //               symbol.tickSize,
    //               symbol.decimalPlace,
    //               (<SymbolCrypto>symbol).baseSymbol,
    //               (<SymbolCrypto>symbol).qouteSymbol
    //             )
    //           );
    //         }
    //       }
    //     }
    //   }
    //   return new Map<string, ISymbol>();
    // } catch (error: unknown) {
    //   console.error(`Unalbe to get symbols, reason: ${(<Error>error).message}`);
    //   throw error;
    // }
  }

  async checkWithdrawalStatus(coinName: string, chain: string) {
    try {
      let serverTime = await this.getServerTime();

      let signature = this.getSignature({
        recvWindow: this.defaultRecvWindow,
        timestamp: serverTime,
      }, BitrueWithdrawCredentials.apiSecret);

      let getSymbolResponse = await this.httpClient
        .get<any>(`${this.apiUrl}/v1/exchangeInfo`, {
          headers: {
            'X-MBX-APIKEY': BitrueWithdrawCredentials.apiKey,
          },
          params: {
            recvWindow: this.defaultRecvWindow,
            timestamp: serverTime,
            signature: signature,
          },
        })
        .toPromise();

      if (
        getSymbolResponse &&
        getSymbolResponse.coins &&
        getSymbolResponse.coins.length > 0
      ) {
        let coins = getSymbolResponse.coins;

        for (let index = 0; index < coins.length; index++) {
          let coin = coins[index];

          if (coin.coin.toUpperCase() != coinName) {
            continue;
          }

          let chainDetail = coin.chainDetail[0];

          if (chainDetail.chain == chain) {
            let enableWithdraw = chainDetail.enableWithdraw;

            let cryptoCoin = this.symbolManagerService.getCryptoCoin(
              this.tradeInterface,
              this.segment,
              coin.coin.toUpperCase()
            );

            if (cryptoCoin) {
              cryptoCoin.enableWithdraw = enableWithdraw;
              this.appService.appEvents.emit({
                MessageType: MessageTypes.COIN_UPDATE_EVENT,
                Data: cryptoCoin,
              });
            }

            if (enableWithdraw === true) {
              return true;
            }
          }
        }
      }
    } catch (error: any) {
      console.error(
        `Unalbe to check withdrawal status, reason: ${error.message}`
      );
    }

    return false;
  }

  async cancelOrder(order: IOrder) {
    // ignore cancel order if order is not from this segment or trade interface
    if (
      order.symbol.segment != this.segment &&
      order.symbol.tradeInterface != this.tradeInterface
    ) {
      return;
    }

    let serverTime = await this.getServerTime();

    let signature = this.getSignature({
      recvWindow: this.defaultRecvWindow,
      timestamp: serverTime,
      symbol: order.symbol.token,
      orderId: order.orderId,
    });

    let cancelOrderResponse = await this.httpClient
      .delete<any>(`${this.apiUrl}/v1/order`, {
        headers: {
          'X-MBX-APIKEY': this.apiKey,
          'Content-type': 'application/x-www-form-urlencoded',
        },
        params: {
          recvWindow: this.defaultRecvWindow,
          timestamp: serverTime,
          symbol: order.symbol.token,
          orderId: order.orderId,
          signature: signature,
        },
      })
      .toPromise();
  }

  async cancelAllOrders() {
    let getSymbolsResponse = await this.httpClient
      .delete<BaseResponse<ISymbol[]>>(`${environment.apiUrl}/orders`, {
        params: {
          tradeInterface: TradeInterface[this.tradeInterface],
        },
      })
      .toPromise();
  }

  async placeOrder(
    symbol: ISymbol,
    transactionType: TransactionType,
    orderType: OrderType,
    orderPrice: Price,
    orderQuantity: Quantity,
    magicNumber: string = ''
  ) {
    try {
      let serverTime = await this.getServerTime();

      let orderDetails: any = {
        recvWindow: this.defaultRecvWindow,
        timestamp: serverTime,
        symbol: symbol.token,
        side: TransactionType[transactionType].toUpperCase(),
        type: OrderType[orderType].toUpperCase(),
        price: orderPrice,
        quantity: orderQuantity,
        timeInForce: 'GTC',
      }

      if (magicNumber) {
        orderDetails.newClientOrderId = magicNumber;
      }

      let signature = this.getSignature(orderDetails);

      let orderDetailsWithSignature = {
        ...orderDetails,
        signature: signature,
      }

      let placeOrderResponse = await this.httpClient
        .post<any>(`${this.apiUrl}/v1/order`, null, {
          headers: {
            'X-MBX-APIKEY': this.apiKey,
          },
          params: orderDetailsWithSignature,
        })
        .toPromise();

      console.info(
        `${TradeInterface[this.tradeInterface]
        } Place Order Response: ${JSON.stringify(placeOrderResponse)}`
      );

      return placeOrderResponse;
    } catch (error: any) {
      console.error(
        `Unalbe to place BitrueInteractive ${symbol.token} order, reason: ${error.message}, JSON: ${JSON.stringify(error)}`
      );
      console.error(
        `order details: symbol=${symbol.token}, transactionType=${TransactionType[transactionType].toUpperCase()}, orderType=${OrderType[orderType].toUpperCase()}, orderPrice=${orderPrice}, orderQuantity=${orderQuantity}`
      );
    }
  }

  async connectInteractiveSocket() {
    this.interactiveSocket = undefined;
    await this.createListenerKey();

    this.interactiveSocket = new WebSocket(
      `${this.socketUrl}/stream?listenKey=${this.listernerKey}`
    );

    this.registerInteractiveEvents();
  }

  async sendPongMessage() {
    if (!this.isPongTimerInitialized) {
      this.isPongTimerInitialized = true;
      console.info(
        `${TradeInterface[this.tradeInterface]
        } interactive socket sending pong message.`
      );

      let pongTimer = setTimeout(() => {
        clearTimeout(pongTimer);
        this.interactiveSocket?.send(
          JSON.stringify({ event: 'pong', ts: new Date().getTime() })
        );
      }, 300000);
    }
  }

  async registerInteractiveEvents() {
    if (this.interactiveSocket) {
      this.interactiveSocket.onopen = async () => {
        console.info(
          `${TradeInterface[this.tradeInterface]} interactive socket connected.`
        );

        this.interactiveSocket?.send(
          JSON.stringify({
            event: 'sub',
            params: { channel: 'user_order_update' },
          })
        );

        this.interactiveSocket?.send(
          JSON.stringify({
            event: 'sub',
            params: { channel: 'user_balance_update' },
          })
        );

        this.sendPongMessage();
      };

      this.interactiveSocket.onclose = async (data) => {
        // console.error(
        //   `${TradeInterface[this.tradeInterface]} interactive socket closed.`
        // );
        this.connectInteractiveSocket();
      };

      this.interactiveSocket.onerror = async (error) => {
        console.error(
          `${TradeInterface[this.tradeInterface]
          } interactive socket error: ${JSON.stringify(error)}`
        );
      };

      this.interactiveSocket.onmessage = async (message) => {
        let data = JSON.parse(message.data);

        if (data.e) {
          switch (data.e) {
            case 'ORDER':
              {
                let symbol = this.symbolManagerService.getSymbol(
                  this.tradeInterface,
                  this.segment,
                  data.s.toUpperCase()
                );

                if (symbol) {
                  let order = new Order(
                    symbol,
                    data.iStr.toString(),
                    data.S == 1 ? TransactionType.Buy : TransactionType.Sell,
                    data.o == 1 ? OrderType.Limit : OrderType.Market,
                    parseFloat(data.q),
                    parseFloat(data.p),
                    parseFloat(data.z),
                    parseFloat(data.L),
                    parseFloat(data.O),
                    data.T ? parseFloat(data.T) : parseFloat(data.O),
                    this.mapOrderStatus(data.X),
                    0,
                    data.c
                  );

                  this.appService.appEvents.emit({
                    MessageType: MessageTypes.ORDER_UPDATE_EVENT,
                    Data: order,
                  });
                }
              }
              break;
            case 'BALANCE':
              {
                for (let index in data.B) {
                  let symbol = data.B[index].a.toUpperCase();
                  if (data.B[index].F) {
                    let free = parseFloat(data.B[index].F);
                    let locked = parseFloat(data.B[index].L);
                    let cryptoCoin = this.symbolManagerService.getCryptoCoin(
                      this.tradeInterface,
                      this.segment,
                      symbol
                    );

                    // console.info(
                    //   `${TradeInterface[this.tradeInterface]} Balance Update Event: ${index} - ${JSON.stringify(data.B[index])}`
                    // );

                    if (cryptoCoin) {
                      let accountBalance = new AccountBalance(
                        cryptoCoin,
                        free,
                        locked
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
              break;

            default:
              break;
          }
        }
      };
    }

    // let rprUSDTSymbol = SymbolService.Instance.getSymbol(
    //   TradeInterface.BiTrueApi,
    //   Segment.BiTrue,
    //   'RPRUSDT'
    // );

    // if (rprUSDTSymbol) {
    //   console.info('Symbol Found');
    //   let result = await this.placeOrder(
    //     rprUSDTSymbol,
    //     TransactionType.Buy,
    //     OrderType.Limit,
    //     0.0316,
    //     4574
    //   );

    //   let test = result;
    // }

    // this.interactiveSocket?.on('message', function (messageData) {
    //   let data = JSON.parse(messageData.toString());

    //   if (data.e) {
    //     switch (data.e) {
    //       case 'ORDER':
    //         {
    //           let symbol = SymbolService.Instance.getSymbol(
    //             this.tradeInterface,
    //             this.segment,
    //             data.s.toUpperCase()
    //           );

    //           if (symbol) {
    //             let order = new Order(
    //               symbol,
    //               data.iStr.toString(),
    //               data.S == 1 ? TransactionType.Buy : TransactionType.Sell,
    //               data.o == 1 ? OrderType.Limit : OrderType.Market,
    //               parseFloat(data.q),
    //               parseFloat(data.p),
    //               parseFloat(data.z),
    //               parseFloat(data.L),
    //               parseFloat(data.O),
    //               data.T ? parseFloat(data.T) : parseFloat(data.O),
    //               isNaN(data.X)
    //                 ? this.convertToOrderStatusByString(data.X)
    //                 : this.convertToOrderStatus(data.X)
    //             );

    //             this.openOrders.set(order.getUniqueKey(), order);

    //             SocketServerService.Instance.sendMessage(
    //               MessageTypes.ORDER_UPDATE_EVENT,
    //               order
    //             );

    //             SocketServerService.Instance.onOrderPartialFill(order);
    //           }
    //         }
    //         break;
    //       case 'BALANCE':
    //         {
    //           for (let index in data.B) {
    //             let symbol = data.B[index].a.toUpperCase();
    //             let free = parseFloat(data.B[0].F);
    //             let locked = parseFloat(data.B[0].L);
    //             let cryptoCoin = SymbolService.Instance.getCryptoCoin(
    //               this.tradeInterface,
    //               this.segment,
    //               symbol
    //             );

    //             if (cryptoCoin) {
    //               let accountBalance = new AccountBalance(
    //                 cryptoCoin,
    //                 free,
    //                 locked
    //               );
    //               this.balances.set(
    //                 accountBalance.cryptoCoin.getUniqueKey(),
    //                 accountBalance
    //               );

    //               SocketServerService.Instance.sendMessage(
    //                 MessageTypes.BALANCE_UPDATE_EVENT,
    //                 accountBalance
    //               );
    //             }
    //           }
    //         }
    //         break;

    //       default:
    //         break;
    //     }
    //   }
    // });
  }

  async registerMarketDataEvents(marketDataSocket: WebSocket, symbol: string) {
    marketDataSocket.onopen = async () => {
      console.info(
        `${TradeInterface[this.tradeInterface]
        } ${symbol} marketData socket connected.`
      );

      for (let index = 0; index < this.symbols.length; index++) {
        let symbol = this.symbols[index];
        await new Promise(resolve => setTimeout(resolve, 1000));
        marketDataSocket.send(this.createSybscribeRequest(symbol));
      }

      //marketDataSocket.send(this.createSybscribeRequest(symbol));
    };

    marketDataSocket.onclose = async () => {
      console.error(
        `${TradeInterface[this.tradeInterface]
        } ${symbol} marketData socket closed.`
      );
      this.connectMarketDataSocket(symbol);
    };

    marketDataSocket.onmessage = async (socketMessage) => {
      try {
        if (socketMessage.data instanceof Blob) {
          let message: any = {};
          let reader = new FileReader();
          reader.onload = () => {
            let arrayBuffer = reader.result as ArrayBuffer;
            let data = new Uint8Array(arrayBuffer);
            let decompressed = pako.inflate(data);
            let messageString = new TextDecoder().decode(decompressed);
            message = JSON.parse(messageString);

            try {
              let marketDepths = new MarketDepths(
                '',
                this.segment,
                this.tradeInterface,
                [],
                []
              );

              if (message.tick && message.channel) {
                marketDepths.token = this.getSymbolByMarketDepthChannel(
                  message.channel
                );
                marketDepths.symbol = marketDepths.token;
              }

              if (marketDepths.token) {
                for (let index = 0; index < message.tick.asks.length; index++) {
                  let ask = message.tick.asks[index];
                  let marketDepthInfo = new MarketDepthInfo(
                    parseFloat(ask[0]),
                    parseFloat(ask[1]),
                    0
                  );
                  marketDepths.asks.push(marketDepthInfo);
                }

                for (let index = 0; index < message.tick.buys.length; index++) {
                  let bid = message.tick.buys[index];
                  let marketDepthInfo = new MarketDepthInfo(
                    parseFloat(bid[0]),
                    parseFloat(bid[1]),
                    0
                  );
                  marketDepths.bids.push(marketDepthInfo);
                }

                this.appService.appEvents.emit({
                  MessageType: MessageTypes.MARKET_DEPTH_MESSAGE_EVENT,
                  Data: marketDepths,
                });
              }
            } catch (error) {
              console.error(
                `Market data socket data error => ${(<Error>error).message}`
              );
            }
          };
          reader.readAsArrayBuffer(socketMessage.data);
        }
      } catch (error) {
        console.error(
          `${TradeInterface[this.tradeInterface]
          } ${symbol} marketData socket zlib error => ${(<Error>error).message}`
        );
      }
    };

    // marketDataSocket.on('message', function (data) {
    //   try {
    //     unzip(new Uint8Array(Buffer.from(data)), function (err, buffer) {
    //       if (!err) {
    //         try {
    //           let message = JSON.parse(buffer.toString('utf8'));
    //           let marketDepths = new MarketDepths('', [], []);

    //           if (message.tick && message.channel) {
    //             marketDepths.token =
    //               BiTrueInteractive.Instance.getSymbolByMarketDepthChannel(
    //                 message.channel
    //               );
    //           }

    //           if (marketDepths.token) {
    //             for (let index = 0; index < message.tick.asks.length; index++) {
    //               let ask = message.tick.asks[index];
    //               let marketDepthInfo = new MarketDepthInfo(
    //                 parseFloat(ask[0]),
    //                 parseFloat(ask[1]),
    //                 0
    //               );
    //               marketDepths.asks.push(marketDepthInfo);
    //             }

    //             for (let index = 0; index < message.tick.buys.length; index++) {
    //               let bid = message.tick.buys[index];
    //               let marketDepthInfo = new MarketDepthInfo(
    //                 parseFloat(bid[0]),
    //                 parseFloat(bid[1]),
    //                 0
    //               );
    //               marketDepths.bids.push(marketDepthInfo);
    //             }

    //             BiTrueInteractive.Instance.events.emit(
    //               MessageTypes.MARKET_DEPTH_MESSAGE_EVENT,
    //               marketDepths
    //             );
    //           }
    //         } catch (error) {
    //           console.error(
    //             `${
    //               TradeInterface[BiTrueInteractive.Instance.tradeInterface]
    //             } marketData socket data error => ${(<Error>error).message}`
    //           );
    //         }
    //       }
    //     });
    //   } catch (error) {
    //     console.error(
    //       `${
    //         TradeInterface[BiTrueInteractive.Instance.tradeInterface]
    //       } ${symbol} marketData socket zlib error => ${(<Error>error).message}`
    //     );
    //   }
    // });

    marketDataSocket.onerror = async (data) => {
      console.error(
        `${TradeInterface[this.tradeInterface]
        } ${symbol} marketData socket error: ${JSON.stringify(data)}`
      );
    };
  }

  async connectMarketDataSocket(symobl: string) {
    let marketDataSocket = new WebSocket(`${this.socketMarketDataUrl}`);

    //this.marketDataSockets.set(symobl, marketDataSocket);
    this.registerMarketDataEvents(marketDataSocket, symobl);
  }

  async withdrawCoin(
    symbol: string,
    chainName: string,
    withdrawAddress: string,
    amount: string,
    memo: string = ''
  ) {
    try {
      let cryptoCoin = this.symbolManagerService.getCryptoCoin(
        this.tradeInterface,
        this.segment,
        symbol
      );

      if (!cryptoCoin) {
        return;
      }

      if (parseInt(amount) < cryptoCoin.minWithdraw * 1.05) {
        console.error(
          `Minimum withdraw error ${cryptoCoin.minWithdraw} error.`
        );
        return;
      }

      if (!cryptoCoin.chains.includes(chainName)) {
        return;
      }

      let serverTime = await this.getServerTime();

      let withdrawDetails: any = {
        recvWindow: this.defaultRecvWindow,
        timestamp: serverTime,
        coin: symbol,
        amount: parseInt(amount.toString()),
        addressTo: withdrawAddress,
        chainName: chainName,
      };

      if (memo) {
        withdrawDetails.tag = memo;
      }

      let signature = this.getSignature(withdrawDetails, BitrueWithdrawCredentials.apiSecret);

      let params = withdrawDetails;
      params.signature = signature;

      let withdrawResponse = await this.httpClient
        .post<any>(`${this.apiUrl}/v1/withdraw/commit`, null, {
          headers: {
            'X-MBX-APIKEY': BitrueWithdrawCredentials.apiKey,
          },
          params: params,
        })
        .toPromise();

      if (withdrawResponse) {
        console.info(
          `BitrueInteractive ${symbol} amount ${amount} withdraw successfull.`
        );
      } else {
        console.info(
          `Withdraw failed BitrueInteractive ${symbol} amount ${amount}, reason: ${JSON.stringify(
            withdrawResponse
          )}`
        );
      }

      return withdrawResponse;
    } catch (error) {
      console.error(
        `Unalbe to withraw BitrueInteractive ${symbol}, reason: ${(<Error>error).message
        }`
      );
    }
  }

  getSymbolByMarketDepthChannel(marketDepthChannel: string) {
    return marketDepthChannel.split('_')[1].toUpperCase();
  }

  getMarketDepthChannel(symbol: string) {
    return `market_${symbol.toLowerCase()}_depth_step0`;
  }

  createSybscribeRequest(symbol: string) {
    return JSON.stringify({
      event: 'sub',
      params: {
        channel: this.getMarketDepthChannel(symbol),
        cb_id: symbol.toLowerCase(),
      },
    });
  }

  convertToOrderStatus(orderStatus: string | number): OrderStatus {
    switch (orderStatus) {
      case 0:
      case 1:
        return OrderStatus.New;
      case 2:
        return OrderStatus.Filled;
      case 3:
        return OrderStatus.PartiallyFilled;
      case 4:
        return OrderStatus.Cancelled;
      default:
        return OrderStatus.None;
    }
  }

  convertToOrderStatusByString(orderStatus: string): OrderStatus {
    switch (orderStatus.toUpperCase()) {
      case 'NEW':
        return OrderStatus.New;
      case 'FILLED':
        return OrderStatus.Filled;
      case 'PARTIALLY_FILLED':
        return OrderStatus.PartiallyFilled;
      case 'CANCELLED':
        return OrderStatus.Cancelled;
      default:
        return OrderStatus.None;
    }
  }

  convertToTransactionType(transactionType: string): TransactionType {
    switch (transactionType.toUpperCase()) {
      case 'BUY':
        return TransactionType.Buy;
      case 'SELL':
        return TransactionType.Sell;
      default:
        return TransactionType.None;
    }
  }

  convertToOrderType(orderType: string): OrderType {
    switch (orderType.toUpperCase()) {
      case 'LIMIT':
        return OrderType.Limit;
      case 'MARKET':
        return OrderType.Market;
      default:
        return OrderType.None;
    }
  }

  /**
   * Gets orders by symbol and magic number (client order ID) from Bitrue API
   * @param symbol Trading symbol
   * @param magicNumber Magic number (client order ID)
   * @returns Array of orders matching the criteria
   */
  async getOrdersByMagicNumber(symbol: string, magicNumber: string): Promise<IOrder[]> {
    let initialOrderResponse: any;
    try {
      // Step 1: Initial query using origClientOrderId
      this.logWithTimestamp(`[BiTrue] Querying order by magicNumber: ${magicNumber}, symbol: ${symbol}`);
      const serverTime1 = await this.getServerTime();
      const queryParams1 = {
        recvWindow: this.defaultRecvWindow,
        timestamp: serverTime1,
        symbol: symbol,
        origClientOrderId: magicNumber
      };
      const signature1 = this.getSignature(queryParams1);

      initialOrderResponse = await this.httpClient
        .get<any>(`${this.apiUrl}/v1/order`, {
          headers: { 'X-MBX-APIKEY': this.apiKey },
          params: { ...queryParams1, signature: signature1 }
        })
        .toPromise();

      this.logWithTimestamp(`[BiTrue] Initial order response (magicNumber: ${magicNumber}):`, initialOrderResponse);

    } catch (error: any) {
      // Handle specific API errors for non-existent orders from the initial query
      if (error?.error?.code === -2013 || error?.status === 400) { // -2013: Order does not exist (Bitrue specific?), 400 might indicate not found too
        this.logWithTimestamp(`[BiTrue] Order with magicNumber ${magicNumber} for symbol ${symbol} not found (API Error ${error?.error?.code || error?.status}).`);
        return []; // Order definitely doesn't exist
      } else {
        console.error(`[${TradeInterface[this.tradeInterface]}] Error fetching order by magicNumber ${magicNumber} for symbol ${symbol} (Initial Query):`, error);
        // Decide if we should proceed or return empty based on the error
        // For now, we'll assume other errors might still warrant checking by orderId if we have one cached, but let's return empty for now.
        return []; // Return empty array on unexpected error during initial fetch
      }
    }

    const orders: IOrder[] = [];

    // Step 2: Process the initial response
    if (initialOrderResponse && typeof initialOrderResponse === 'object' && initialOrderResponse.orderId) {
      const initialOrderData = initialOrderResponse;
      const symbolObj = this.symbolManagerService.getSymbol(
        this.tradeInterface,
        this.segment,
        initialOrderData.symbol
      );

      if (!symbolObj) {
        console.error(`[${TradeInterface[this.tradeInterface]}] Symbol object not found for order:`, initialOrderData.symbol);
        return []; // Cannot proceed without symbol info
      }

      // Extract initial details
      let orderId = initialOrderData.orderId;
      let initialStatusString = initialOrderData.status;
      let initialFilledQty = parseFloat(initialOrderData.executedQty);
      let initialStatus = this.mapOrderStatus(initialStatusString);

      // Variables to hold the final order details
      let finalStatus = initialStatus;
      let finalFilledQty = initialFilledQty;
      let finalCummulativeQuoteQty = parseFloat(initialOrderData.cummulativeQuoteQty);
      let finalPrice = parseFloat(initialOrderData.price);
      let finalUpdateTime = initialOrderData.updateTime;

      // Step 3: Check if re-query by orderId is needed
      if (initialFilledQty === 0 && initialStatus === OrderStatus.New) {
        this.logWithTimestamp(`[BiTrue] Order ${orderId} (magicNumber: ${magicNumber}) has 0 filled qty and NEW status. Re-querying by orderId.`);
        try {
          // Step 4: Query by orderId
          const serverTime2 = await this.getServerTime();
          const queryParams2 = {
            recvWindow: this.defaultRecvWindow,
            timestamp: serverTime2,
            symbol: symbol,
            orderId: orderId // Use orderId here
          };
          const signature2 = this.getSignature(queryParams2);

          const orderByIdResponse = await this.httpClient
            .get<any>(`${this.apiUrl}/v1/order`, { // Same endpoint, different query param
              headers: { 'X-MBX-APIKEY': this.apiKey },
              params: { ...queryParams2, signature: signature2 }
            })
            .toPromise();

          this.logWithTimestamp(`[BiTrue] Second query response (orderId: ${orderId}):`, orderByIdResponse);

          // Step 5: Merge results if second query successful
          if (orderByIdResponse && typeof orderByIdResponse === 'object' && orderByIdResponse.orderId) {
            finalStatus = this.mapOrderStatus(orderByIdResponse.status);
            finalFilledQty = parseFloat(orderByIdResponse.executedQty);
            finalCummulativeQuoteQty = parseFloat(orderByIdResponse.cummulativeQuoteQty);
            // finalPrice might still be relevant if the order was cancelled before filling
            finalPrice = parseFloat(orderByIdResponse.price);
            finalUpdateTime = orderByIdResponse.updateTime;
            this.logWithTimestamp(`[BiTrue] Updated order ${orderId} details from second query: status=${OrderStatus[finalStatus]}, filled=${finalFilledQty}`);
          } else {
            this.logWithTimestamp(`[BiTrue] Second query for orderId ${orderId} did not return a valid order. Using initial data.`);
          }

        } catch (error: any) {
          // Log error from the second query but proceed with initial data
          console.error(`[${TradeInterface[this.tradeInterface]}] Error re-fetching order by orderId ${orderId}:`, error);
          this.logWithTimestamp(`[BiTrue] Failed to re-query by orderId ${orderId}. Using initial data.`);
        }
      }

      // Step 6: Construct the final IOrder object
      const avgPrice = finalFilledQty > 0 ? (finalCummulativeQuoteQty / finalFilledQty) : finalPrice;

      const orderObj = new Order(
        symbolObj,
        orderId,
        this.convertToTransactionType(initialOrderData.side), // Side and Type unlikely to change
        this.convertToOrderType(initialOrderData.type),
        parseFloat(initialOrderData.origQty),
        finalPrice, // Use potentially updated price (though less likely to change than status/fill)
        finalFilledQty, // Use potentially updated filled quantity
        avgPrice, // Use calculated average price based on potentially updated values
        initialOrderData.time, // Original creation time
        finalUpdateTime, // Use potentially updated update time
        finalStatus, // Use potentially updated status
        0, // otherQuantity - Assuming not applicable here
        initialOrderData.clientOrderId // Original clientOrderId (magicNumber)
      );

      orders.push(orderObj);

    } else if (initialOrderResponse && (!initialOrderResponse.orderId || typeof initialOrderResponse !== 'object')) {
      // Log if the response was received but invalid
      console.warn(`[${TradeInterface[this.tradeInterface]}] Received invalid order response for magicNumber ${magicNumber}:`, initialOrderResponse);
    }
    // If initialOrderResponse is null/undefined, the initial catch block handled it or there was no order.

    return orders; // Return array (should contain 0 or 1 order)
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
        .get<any>(`${this.apiUrl}/v1/openOrders`, {
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
        console.error('Invalid response from Bitrue getOpenOrders:', response);
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
          this.convertToTransactionType(order.side),
          this.convertToOrderType(order.type),
          parseFloat(order.origQty),
          parseFloat(order.price),
          parseFloat(order.executedQty),
          parseFloat(order.price), // Using price as averagePrice since it's not provided
          order.time,
          order.updateTime,
          this.convertToOrderStatus(order.status),
          0, // otherQuantity
          order.clientOrderId
        );
      }).filter(order => order !== null) as IOrder[];
    } catch (error) {
      console.error('Error fetching Bitrue orders:', error);
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
        return OrderStatus.None;
    }
  }

  private extractMagicNumber(clientOrderId: string): number | undefined {
    if (!clientOrderId) return undefined;
    const match = clientOrderId.match(/MN(\d+)/);
    return match ? parseInt(match[1]) : undefined;
  }

  /**
   * Fetches all historical orders for a symbol within a given time range from Bitrue.
   * Note: Endpoint `/api/v1/allOrders` is assumed based on common patterns.
   * @param symbol The trading symbol (e.g., 'XRPUSDT')
   * @param startTime The start time in milliseconds since epoch.
   * @param limit Maximum number of orders to retrieve (default 500, max 1000).
   * @returns A promise resolving to an array of IOrder objects.
   */
  async getAllOrdersBySymbolAndTime(symbol: string, startTime: number, limit: number = 1000): Promise<IOrder[]> {
    try {
      this.logWithTimestamp(`[BiTrue] Fetching all orders for ${symbol} starting from ${new Date(startTime).toISOString()}`);
      const serverTime = await this.getServerTime();
      const params: any = {
        symbol: symbol,
        startTime: startTime,
        limit: Math.min(limit, 1000), // Assuming Bitrue also has a limit, capped at 1000
        recvWindow: this.defaultRecvWindow,
        timestamp: serverTime,
      };

      const signature = this.getSignature(params);
      params['signature'] = signature;

      // *** ASSUMPTION: Endpoint is /api/v1/allOrders ***
      // This might need adjustment based on actual Bitrue documentation.
      const response = await this.httpClient
        .get<any[]>(`${this.apiUrl}/v1/allOrders`, {
          headers: { 'X-MBX-APIKEY': this.apiKey },
          params: params,
        })
        .toPromise();

      if (!response || !Array.isArray(response)) {
        console.error(`[BiTrue] Invalid response from getAllOrdersBySymbolAndTime for ${symbol}:`, response);
        return [];
      }

      this.logWithTimestamp(`[BiTrue] Received ${response.length} orders from allOrders API for ${symbol}`);

      const orders: IOrder[] = response.map(orderData => {
        const symbolObj = this.symbolManagerService.getSymbol(
          this.tradeInterface,
          this.segment,
          orderData.symbol
        );

        if (!symbolObj) {
          console.error(`[BiTrue] Symbol object not found for order: ${orderData.symbol}`);
          return null; // Skip if symbol info is missing
        }

        const filledQty = parseFloat(orderData.executedQty);
        // Bitrue /v1/order uses cummulativeQuoteQty, assume allOrders does too
        const avgPrice = filledQty > 0 ? (parseFloat(orderData.cummulativeQuoteQty) / filledQty) : parseFloat(orderData.price);

        return new Order(
          symbolObj,
          orderData.orderId,
          this.convertToTransactionType(orderData.side),
          this.convertToOrderType(orderData.type),
          parseFloat(orderData.origQty),
          parseFloat(orderData.price),
          filledQty,
          avgPrice,
          orderData.time, // Creation time
          orderData.updateTime, // Last update time
          this.mapOrderStatus(orderData.status), // Use the robust status mapping
          0, // otherQuantity - Assuming not applicable
          orderData.clientOrderId // Include clientOrderId
        );
      }).filter(order => order !== null) as IOrder[]; // Filter out nulls

      return orders;

    } catch (error: any) {
      console.error(`[BiTrue] Error fetching all orders for symbol ${symbol}:`, error);
      // Handle specific errors if known (e.g., endpoint not found)
      if (error?.status === 404) {
        console.error(`[BiTrue] The assumed endpoint /api/v1/allOrders was not found (404). Please verify the correct Bitrue endpoint.`);
      }
      return []; // Return empty array on error
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
