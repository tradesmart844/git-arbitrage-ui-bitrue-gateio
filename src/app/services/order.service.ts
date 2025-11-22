import { EventEmitter, Injectable, Output } from '@angular/core';
import { IOrder } from '../interfaces/order-interface';
import { AccountBalance } from '../models/account-balance';
import { HttpClient } from '@angular/common/http';
import { AppService } from './app.service';
import {
  MessageTypes,
  OrderType,
  Price,
  Quantity,
  Segment,
  TradeInterface,
  TransactionType,
} from '../helpers/enums';
import { ISymbol } from '../interfaces/symbol-interface';
import { from } from 'linq';
import { CryptoCoin } from '../models/crypto-coin';
import { BaseResponse } from '../models/base-response';
import { environment } from '../../environments/environment.prod';
import { Order } from '../models/order';
import { IAccountBalance } from '../interfaces/account-balance-interface';
import { MexcApiInteractiveService } from './mexc-api-interactive.service';
import { BitrueInteractiveService } from './bitrue-interactive.service';
import { MessageDataInterface } from '../interfaces/message-data-interface';
import { Subscription } from 'rxjs';
import { SymbolManagerService } from './symbol-manager.service';
import { GateIOApiInteractiveService } from './gateio-api-interactive.service';

@Injectable({
  providedIn: 'root',
})
export class OrderService {
  orders: Map<string, IOrder> = new Map<string, IOrder>();
  balances: Map<string, AccountBalance> = new Map<string, AccountBalance>();

  @Output() events: EventEmitter<MessageDataInterface<any>> = new EventEmitter<
    MessageDataInterface<any>
  >();

  appSubscription: Subscription | undefined;
  isWithdrawDone: boolean = false;

  constructor(
    private httpClient: HttpClient,
    private appService: AppService,
    private bitrueInteractiveService: BitrueInteractiveService,
    private mexcApiInteractiveService: MexcApiInteractiveService,
    private gateioApiInteractiveService: GateIOApiInteractiveService,
    private symbolManagerService: SymbolManagerService
  ) { }

  async init() {
    this.appSubscription = this.appService.appEvents.subscribe(
      (message: MessageDataInterface<any>) => {
        // Handle different types of messages
        switch (message.MessageType) {
          case MessageTypes.APP_READY_EVENT:
            this.onAppReady.bind(this)();
            break;
          case MessageTypes.ORDER_UPDATE_EVENT:
            this.onOrderUpdate.bind(this)(message.Data as IOrder);
            break;
          case MessageTypes.BALANCE_UPDATE_EVENT:
            this.onBalanceUpdate.bind(this)(message.Data as IAccountBalance);
            break;
        }
      }
    );

    //await this.checkWithdrawalStatus();
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
    try {
      switch (symbol.tradeInterface) {
        case TradeInterface.GateIOApi:
          {
            orderQuantity = parseFloat(
              orderQuantity.toFixed(Math.log10(1 / symbol.lotSize))
            );
          }
          this.gateioApiInteractiveService.placeOrder(
            symbol,
            transactionType,
            orderType,
            orderPrice,
            orderQuantity,
            magicNumber
          );
          break;
        case TradeInterface.MEXCApi:
          this.mexcApiInteractiveService.placeOrder(
            symbol,
            transactionType,
            orderType,
            orderPrice,
            orderQuantity,
            magicNumber,
            placeOrderViaWeb
          );
          break;
        case TradeInterface.GateIOApi:
          this.gateioApiInteractiveService.placeOrder(
            symbol,
            transactionType,
            orderType,
            orderPrice,
            orderQuantity,
            magicNumber);
          break;
      }
    } catch (error) {
      console.info(
        `Unable to place order for ${TradeInterface[symbol.tradeInterface]
        } for symbol ${symbol.token}, reason: ${(<Error>error).message}`
      );
    }
  }

  async cancelOrder(order: IOrder) {
    try {
      this.appService.appEvents.emit({
        MessageType: MessageTypes.CANCEL_ORDER_EVENT,
        Data: order,
      });
    } catch (error) {
      console.info(
        `Unable to cancel orderId ${order.orderId} for ${TradeInterface[order.symbol.tradeInterface]
        } for symbol ${order.symbol.name}, reason: ${(<Error>error).message}`
      );
    }
  }

  async getOpenOrders() {
    this.appService.appEvents.emit({
      MessageType: MessageTypes.GET_ALL_OPEN_ORDERS_EVENT,
      Data: '',
    });
  }

  getBalanceByTradeInterface(tradeInterface: TradeInterface) {
    return from(Array.from(this.balances.values()))
      .where((balance) => {
        return balance.cryptoCoin.tradeInterface == tradeInterface;
      })
      .toArray();
  }

  getBalance(cryptoCoin: CryptoCoin) {
    return this.balances.get(cryptoCoin.getUniqueKey());
  }

  async getBalances() {
    try {
      this.orders = new Map<string, IOrder>();
      let getBalanceResponse = await this.httpClient
        .get<BaseResponse<AccountBalance[]>>(
          `${environment.apiUrl}/account/balances`
        )
        .toPromise();

      if (
        getBalanceResponse &&
        !getBalanceResponse.error &&
        getBalanceResponse.data.length > 0
      ) {
        for (let index = 0; index < getBalanceResponse.data.length; index++) {
          let balance = new AccountBalance(
            CryptoCoin.getCryptoCoin(getBalanceResponse.data[index].cryptoCoin),
            getBalanceResponse.data[index].free,
            getBalanceResponse.data[index].locked
          );

          let uniqueKey = balance.cryptoCoin.getUniqueKey();

          if (this.balances.has(uniqueKey)) {
            let existingBalance = this.balances.get(uniqueKey);

            if (existingBalance) {
              existingBalance.free = balance.free;
              existingBalance.locked = balance.locked;
            }
          } else {
            this.balances.set(balance.cryptoCoin.getUniqueKey(), balance);
          }
        }
      }
    } catch (error) {
      console.info(
        `Unable to get account balance, reason: ${(<Error>error).message}`
      );
    }

    this.events.emit({
      MessageType: MessageTypes.BALANCE_REFRESH_EVENT,
      Data: Array.from(this.balances.values()),
    });
    return this.balances;
  }

  onOrderUpdate(order: IOrder) {
    let openOrder = Order.getOrder(order);
    this.orders.set(openOrder.getUniqueKey(), openOrder);
    this.events.emit({
      MessageType: MessageTypes.ORDER_UPDATE_EVENT,
      Data: order,
    });
  }

  async onAppReady() {
    this.getOpenOrders();
  }

  async onBalanceUpdate(accountBalance: IAccountBalance) {
    let balance = new AccountBalance(
      CryptoCoin.getCryptoCoin(accountBalance.cryptoCoin),
      accountBalance.free,
      accountBalance.locked
    );

    let existingBalance = this.balances.get(balance.cryptoCoin.getUniqueKey());

    if (existingBalance) {
      existingBalance.free = balance.free;
      existingBalance.locked = balance.locked;
    } else {
      this.balances.set(balance.cryptoCoin.getUniqueKey(), balance);
    }

    this.events.emit({
      MessageType: MessageTypes.BALANCE_UPDATE_EVENT,
      Data: balance,
    });
  }

  async refreshBalances() {
    this.appService.appEvents.emit({
      MessageType: MessageTypes.GET_BALANCE_EVENT,
      Data: '',
    });

    this.appService.appEvents.emit({
      MessageType: MessageTypes.GET_ALL_OPEN_ORDERS_EVENT,
      Data: '',
    });
  }

  async withdraw(cryptoCoin: CryptoCoin) {
    try {
      let withdrawResponse = await this.httpClient
        .get<BaseResponse<any>>(
          `${environment.apiUrl}/account/balances/withdraw`,
          {
            params: {
              tradeInterface: TradeInterface[cryptoCoin.tradeInterface],
              segment: Segment[cryptoCoin.segment],
              symbol: cryptoCoin.coin,
            },
          }
        )
        .toPromise();
    } catch (error) {
      console.info(
        `Unable to withdraw symbol ${cryptoCoin.getUniqueKey()}, reason: ${(<Error>error).message
        }`
      );
    }
  }

  async withdrawUSDT(cryptoCoin: CryptoCoin, balanceToWithdraw: number = 0) {
    try {
      let balance = this.balances.get(cryptoCoin.getUniqueKey());

      if (!balance) {
        return;
      }

      if (balance.free <= 0) {
        return;
      }

      switch (cryptoCoin.tradeInterface) {
        case TradeInterface.GateIOApi:
          {
            let response = await this.gateioApiInteractiveService.withdrawCoin(
              cryptoCoin.coin,
              'TRX',
              'TKHidyeHJsMjW2mqhtCeqD3HBy2FUVTYDZ',
              balanceToWithdraw > 0
                ? balanceToWithdraw.toString()
                : balance.free.toString()
            );
            // let response = await this.gateioApiInteractiveService.withdrawCoin(
            //   cryptoCoin.coin,
            //   'MATIC',
            //   '0x24f86b090949df40a6946ebacc7e8c80d4686936',
            //   balanceToWithdraw > 0
            //     ? balanceToWithdraw.toString()
            //     : balance.free.toString()
            // );
            // let response = await this.gateioApiInteractiveService.withdrawCoin(
            //   cryptoCoin.coin,
            //   'Arbitrum',
            //   '0x24f86b090949df40a6946ebacc7e8c80d4686936',
            //   balanceToWithdraw > 0
            //     ? balanceToWithdraw.toString()
            //     : balance.free.toString()
            // );
          }
          break;
        case TradeInterface.BiTrueApi:
          {
            let response = await this.mexcApiInteractiveService.withdrawCoin(
              cryptoCoin.coin,
              'TRX',
              'TXk4UxurR4HiA4rFHHBG2XQcxYRuZFKHMs',
              balanceToWithdraw > 0
                ? balanceToWithdraw.toString()
                : balance.free.toString()
            );
          }
          break;
      }

      //console.info('URL====>' + environment.apiUrl);

      // let withdrawResponse = await this.httpClient
      //   .get<BaseResponse<any>>(
      //     `${environment.apiUrl}/account/balances/withdraw/coin`,
      //     {
      //       params: {
      //         tradeInterface: TradeInterface[cryptoCoin.tradeInterface],
      //         segment: Segment[cryptoCoin.segment],
      //         symbol: cryptoCoin.coin,
      //         chainName: 'TRX',
      //         withdrawAddress: 'TTz2GUpjFfrXK3JWkhncPAMEn5LBbEnHBm',
      //         amount: balance.free.toString(),
      //       },
      //     }
      //   )
      //   .toPromise();
    } catch (error) {
      console.info(
        `Unable to withdraw symbol ${cryptoCoin.getUniqueKey()}, reason: ${(<Error>error).message
        }`
      );
    }
  }

  async withdrawXDC(cryptoCoin: CryptoCoin, balanceToWithdraw: number = 0) {
    // try {
    //   let balance = this.balances.get(cryptoCoin.getUniqueKey());

    //   if (!balance) {
    //     return;
    //   }

    //   if (balance.free <= 0) {
    //     return;
    //   }

    //   //Add check for if balance to withdraw is less than free balance
    //   if (balance.free < balanceToWithdraw) {
    //     return;
    //   }

    //   switch (cryptoCoin.tradeInterface) {
    //     case TradeInterface.MEXCApi:
    //       {
    //         let response = await this.mexcApiInteractiveService.withdrawCoin(
    //           cryptoCoin.coin,
    //           'XDC',
    //           'xdcEED63FA0E9C70D142c2F8c3df94c41Ee794343e5',
    //           balanceToWithdraw > 0
    //             ? balanceToWithdraw.toString()
    //             : balance.free.toString()
    //         );
    //       }
    //       break;
    //     case TradeInterface.GateIOApi:
    //       {
    //         let response = await this.gateioApiInteractiveService.withdrawCoin(
    //           cryptoCoin.coin,
    //           'XDC',
    //           'xdc4338c3aE089bF4d19089C496E27D7FD9C0256a32',
    //           balanceToWithdraw > 0
    //             ? balanceToWithdraw.toString()
    //             : balance.free.toString()
    //         );
    //       }
    //       break;
    //   }
    // } catch (error) {
    //   console.info(
    //     `Unable to withdraw symbol ${cryptoCoin.getUniqueKey()}, reason: ${(<Error>error).message
    //     }`
    //   );
    // }
  }

  async withdrawSOLO(cryptoCoin: CryptoCoin, amount = 0) {
    // try {
    //   let balance = this.balances.get(cryptoCoin.getUniqueKey());
    //   if (!balance) {
    //     return;
    //   }
    //   if (balance.free <= 0) {
    //     return;
    //   }
    //   switch (cryptoCoin.tradeInterface) {
    //     case TradeInterface.GateIOApi:
    //       {
    //         let response = await this.gateioApiInteractiveService.withdrawCoin(
    //           cryptoCoin.coin,
    //           'XRP',
    //           'rs2dgzYeqYqsk8bvkQR5YPyqsXYcA24MP2',
    //           amount > 0 ? amount.toString() : balance.free.toString(),
    //           '491951'
    //         );
    //       }
    //       break;
    //     case TradeInterface.MEXCApi:
    //       {
    //         let response = await this.mexcApiInteractiveService.withdrawCoin(
    //           cryptoCoin.coin,
    //           'Ripple(XRP)',
    //           'rHcFoo6a9qT5NHiVn1THQRhsEGcxtYCV4d',
    //           amount > 0 ? amount : balance.free,
    //           '323365690'
    //         );
    //       }
    //       break;
    //   }
    // } catch (error) {
    //   console.info(
    //     `Unable to withdraw symbol ${cryptoCoin.getUniqueKey()}, reason: ${(<Error>error).message
    //     }`
    //   );
    // }
  }

  async withdrawCOREUM(cryptoCoin: CryptoCoin, amount = 0) {
    // try {
    //   let balance = this.balances.get(cryptoCoin.getUniqueKey());
    //   if (!balance) {
    //     return;
    //   }
    //   if (balance.free <= 0) {
    //     return;
    //   }
    //   switch (cryptoCoin.tradeInterface) {
    //     case TradeInterface.GateIOApi:
    //       {
    //         let response = await this.gateioApiInteractiveService.withdrawCoin(
    //           cryptoCoin.coin,
    //           'XRP',
    //           'rs2dgzYeqYqsk8bvkQR5YPyqsXYcA24MP2',
    //           amount > 0 ? amount.toString() : balance.free.toString(),
    //           '491951'
    //         );
    //       }
    //       break;
    //     case TradeInterface.MEXCApi:
    //       {
    //         let response = await this.mexcApiInteractiveService.withdrawCoin(
    //           cryptoCoin.coin,
    //           'Ripple(XRP)',
    //           'rHcFoo6a9qT5NHiVn1THQRhsEGcxtYCV4d',
    //           amount > 0 ? amount : balance.free,
    //           '323365690'
    //         );
    //       }
    //       // {
    //       //   let response = await this.mexcApiInteractiveService.withdrawCoin(
    //       //     cryptoCoin.coin,
    //       //     'COREUM',
    //       //     'core10a7t0847dthz3kvs4kagfapu9tk9edkv7v2tcg',
    //       //     amount > 0 ? amount : balance.free,
    //       //     ''
    //       //   );
    //       // }
    //       break;
    //   }
    // } catch (error) {
    //   console.info(
    //     `Unable to withdraw symbol ${cryptoCoin.getUniqueKey()}, reason: ${(<Error>error).message
    //     }`
    //   );
    // }
  }

  async withdrawEWT(cryptoCoin: CryptoCoin, amount = 0) {
    // try {
    //   let balance = this.balances.get(cryptoCoin.getUniqueKey());
    //   if (!balance) {
    //     return;
    //   }
    //   if (balance.free <= 0) {
    //     return;
    //   }
    //   switch (cryptoCoin.tradeInterface) {
    //     case TradeInterface.MEXCApi:
    //       {
    //         let response = await this.mexcApiInteractiveService.withdrawCoin(
    //           cryptoCoin.coin,
    //           'Energy Web Chain(EWC)',
    //           '0xEED63FA0E9C70D142c2F8c3df94c41Ee794343e5',
    //           amount > 0 ? amount : balance.free
    //         );
    //       }
    //       break;
    //     case TradeInterface.GateIOApi:
    //       {
    //         let response = await this.gateioApiInteractiveService.withdrawCoin(
    //           cryptoCoin.coin,
    //           'EWT',
    //           '0x24f86b090949df40a6946ebacc7e8c80d4686936',
    //           amount > 0 ? amount.toString() : balance.free.toString()
    //         );
    //       }
    //       break;
    //   }
    // } catch (error) {
    //   console.info(
    //     `Unable to withdraw symbol ${cryptoCoin.getUniqueKey()}, reason: ${(<Error>error).message
    //     }`
    //   );
    // }
  }

  async withdrawXRP(cryptoCoin: CryptoCoin, amount = 0) {
    // try {
    //   let balance = this.balances.get(cryptoCoin.getUniqueKey());
    //   if (!balance) {
    //     return;
    //   }
    //   if (balance.free <= 0) {
    //     return;
    //   }
    //   switch (cryptoCoin.tradeInterface) {
    //     case TradeInterface.MEXCApi:
    //       {
    //         let response = await this.mexcApiInteractiveService.withdrawCoin(
    //           cryptoCoin.coin,
    //           'Ripple(XRP)',
    //           'rHcFoo6a9qT5NHiVn1THQRhsEGcxtYCV4d',
    //           amount > 0 ? amount : balance.free,
    //           '323365690'
    //         );
    //       }
    //       break;
    //     case TradeInterface.GateIOApi:
    //       {
    //         let response = await this.gateioApiInteractiveService.withdrawCoin(
    //           cryptoCoin.coin,
    //           'XRP',
    //           'rs2dgzYeqYqsk8bvkQR5YPyqsXYcA24MP2',
    //           amount > 0 ? amount.toString() : balance.free.toString(),
    //           '491951'
    //         );
    //       }
    //       break;
    //   }
    // } catch (error) {
    //   console.info(
    //     `Unable to withdraw symbol ${cryptoCoin.getUniqueKey()}, reason: ${(<Error>error).message
    //     }`
    //   );
    // }
  }

  async withdrawHBAR(cryptoCoin: CryptoCoin, amount = 0) {
    // try {
    //   let balance = this.balances.get(cryptoCoin.getUniqueKey());
    //   if (!balance) {
    //     return;
    //   }
    //   if (balance.free <= 0) {
    //     return;
    //   }
    //   switch (cryptoCoin.tradeInterface) {
    //     case TradeInterface.MEXCApi:
    //       {
    //         let response = await this.mexcApiInteractiveService.withdrawCoin(
    //           cryptoCoin.coin,
    //           'Hedera(HBAR)',
    //           '0.0.29000',
    //           amount > 0 ? amount : balance.free,
    //           '013462b307406121'
    //         );
    //       }
    //       break;
    //     case TradeInterface.GateIOApi:
    //       {
    //         let response = await this.gateioApiInteractiveService.withdrawCoin(
    //           cryptoCoin.coin,
    //           'HBAR',
    //           '0.0.858938',
    //           amount > 0 ? amount.toString() : balance.free.toString(),
    //           '149421'
    //         );
    //       }
    //       break;
    //   }
    // } catch (error) {
    //   console.info(
    //     `Unable to withdraw symbol ${cryptoCoin.getUniqueKey()}, reason: ${(<Error>error).message
    //     }`
    //   );
    // }
  }

  async withdrawQNT(cryptoCoin: CryptoCoin, amount = 0) {
    try {
      let balance = this.balances.get(cryptoCoin.getUniqueKey());
      if (!balance) {
        return;
      }
      if (balance.free <= 0) {
        return;
      }
      switch (cryptoCoin.tradeInterface) {
        case TradeInterface.BiTrueApi:
          {
            let response = await this.bitrueInteractiveService.withdrawCoin(
              cryptoCoin.coin,
              'ETH',
              '0xEED63FA0E9C70D142c2F8c3df94c41Ee794343e5',
              amount > 0 ? amount.toString() : balance.free.toString()
            );
          }
          break;
        case TradeInterface.GateIOApi:
          {
            let response = await this.gateioApiInteractiveService.withdrawCoin(
              cryptoCoin.coin,
              'ETH',
              '0x5bcc1eb300d50578ec5c8fa882ea7b941358d7d0',
              amount > 0 ? amount.toString() : balance.free.toString()
            );
          }
          break;
      }
    } catch (error) {
      console.info(
        `Unable to withdraw symbol ${cryptoCoin.getUniqueKey()}, reason: ${(<Error>error).message
        }`
      );
    }
  }

  async checkWithdrawalStatus() {
    return true;
    //let withdrawEnable =
    // await this.bitrueInteractiveService.checkWithdrawalStatus('XDC', 'XDC');
    // // if (withdrawEnable) {
    // //   let cryptoCoin = this.symbolManagerService.getCryptoCoin(
    // //     TradeInterface.BiTrueApi,
    // //     Segment.BiTrue,
    // //     'XDC'
    // //   );
    // //   if (cryptoCoin) {
    // //     // this.appService.appEvents.emit({
    // //     //   MessageType: MessageTypes.WITHDRAW_ENABLE_ALERT,
    // //     //   Data: null,
    // //     // });
    // //     if (!this.isWithdrawDone) {
    // //       //this.isWithdrawDone = true;
    // //       let balance = this.balances.get(cryptoCoin.getUniqueKey());
    // //       if (!balance) {
    // //         return;
    // //       }
    // //       if (balance.free <= 0) {
    // //         return;
    // //       }
    // //       let withdrawAmount = balance.free - 50000;
    // //       if (withdrawAmount > 6000) {
    // //         await this.withdrawXDC(cryptoCoin, withdrawAmount);
    // //       }
    // //     }
    // //   }
    // // }
    // withdrawEnable = false;
    // withdrawEnable = await this.bitrueInteractiveService.checkWithdrawalStatus(
    //   'COREUM',
    //   'XRPL'
    // );
    // // if (withdrawEnable) {
    // //   let cryptoCoin = this.symbolManagerService.getCryptoCoin(
    // //     TradeInterface.BiTrueApi,
    // //     Segment.BiTrue,
    // //     'COREUM'
    // //   );
    // //   if (cryptoCoin) {
    // //     if (!this.isWithdrawDone) {
    // //       let balance = this.balances.get(cryptoCoin.getUniqueKey());
    // //       if (!balance) {
    // //         return;
    // //       }
    // //       if (balance.free <= 0) {
    // //         return;
    // //       }
    // //       let withdrawAmount = balance.free;
    // //       if (withdrawAmount > 1500) {
    // //         await this.withdrawCOREUM(cryptoCoin, 1000);
    // //       }
    // //     }
    // //   }
    // // }
    // let timeoutHandle = setTimeout(async () => {
    //   clearTimeout(timeoutHandle);
    //   await this.checkWithdrawalStatus();
    // }, 1 * 60 * 1000);
  }

  public async getOrdersBySymbol(symbol: ISymbol): Promise<IOrder[]> {
    // Get all orders for this symbol from both exchanges
    const orders: IOrder[] = [];

    try {
      if (symbol.tradeInterface === TradeInterface.MEXCApi) {
        const mexcOrders = await this.mexcApiInteractiveService.getOrdersBySymbol(symbol.token);
        orders.push(...mexcOrders);
      } else if (symbol.tradeInterface === TradeInterface.BiTrueApi) {
        const bitrueOrders = await this.bitrueInteractiveService.getOrdersBySymbol(symbol.token);
        orders.push(...bitrueOrders);
      }
      else if (symbol.tradeInterface === TradeInterface.GateIOApi) {
        const gateioOrders = await this.gateioApiInteractiveService.getOrdersBySymbol(symbol.token);
        orders.push(...gateioOrders);
      }
    } catch (error) {
      console.error(`Error fetching orders for symbol ${symbol.token}:`, error);
    }

    return orders;
  }
}
