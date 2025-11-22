import { HttpClient } from '@angular/common/http';
import { EventEmitter, Injectable, Output } from '@angular/core';
import { MessageTypes } from '../helpers/enums';
import { ArbitragePair } from '../models/arbitrage-pair';
import { MessageDataInterface } from '../interfaces/message-data-interface';
import { Subscription } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class AppService {
  @Output() appEvents: EventEmitter<MessageDataInterface<any>> =
    new EventEmitter<MessageDataInterface<any>>();

  appSubscription: Subscription | undefined;

  alertHandle: any;
  partialFillHandle: any;
  withdrawEnableHandle: any;
  // profitAudio: HTMLAudioElement;
  // orderFillAudio: HTMLAudioElement;

  constructor(private httpClient: HttpClient) {
    // this.profitAudio = new Audio();
    // this.orderFillAudio = new Audio();
  }

  showError(message: string): void {
    console.error(message);
    // TODO: Implement your preferred error display method (toast, alert, etc.)
  }

  onAppReady() {
    this.appEvents.emit({
      MessageType: MessageTypes.APP_READY_EVENT,
      Data: null,
    });

    this.appSubscription = this.appEvents.subscribe(
      (message: MessageDataInterface<any>) => {
        // Handle different types of messages
        switch (message.MessageType) {
          case MessageTypes.ARBITRAGE_PROFIT_MARKET_ALERT:
          case MessageTypes.ARBITRAGE_PROFIT_LIMIT_ALERT:
            this.onArbitrageProfitAtMarketAlert.bind(this)();
            break;
          case MessageTypes.ORDER_PARTIAL_FILL_EVENT:
            this.onOrderPartialFill.bind(this)(message.Data as any);
            break;
          case MessageTypes.WITHDRAW_ENABLE_ALERT:
            this.withdrawEnableAlert.bind(this)();
            break;
        }
      }
    );
  }

  onArbitrageBookSymbolChange(arbitragePair: ArbitragePair) {
    this.appEvents.emit({
      MessageType: MessageTypes.APP_ARBITRAGE_BOOK_SYMBOL_CHANGE_EVENT,
      Data: arbitragePair,
    });
  }

  async onArbitrageProfitAtMarketAlert() {
    if (!this.alertHandle) {
      this.alertHandle = setTimeout(() => {
        clearTimeout(this.alertHandle);
        this.alertHandle = null;
      }, 7000);
      let result = await this.httpClient
        .get<any>(`http://192.168.1.16:4000/orders/alert/profit`, {
          headers: {
            //origin: 'http://192.168.1.16:4204',
            //referer: 'http://192.168.1.16:4204',
            //origin: `http://192.168.1.6:4200`,
            //referer: 'http://192.168.1.6:4200',
            //origin: 'https://openapi.bitrue.com',
            //'X-MBX-APIKEY': this.apiKey,
          },
        })
        .toPromise();
    }
  }

  async onOrderPartialFill(order: any) {
    if (!this.partialFillHandle) {
      this.partialFillHandle = setTimeout(() => {
        clearTimeout(this.partialFillHandle);
        this.partialFillHandle = null;
      }, 3000);

      let result = await this.httpClient
        .get<any>(`http://192.168.1.16:4000/orders/alert/partial`, {
          headers: {
            //origin: 'http://192.168.1.16:4204',
            //referer: 'http://192.168.1.16:4204',
            //origin: `http://192.168.1.6:4200`,
            //referer: 'http://192.168.1.6:4200',
            //origin: 'https://openapi.bitrue.com',
            //'X-MBX-APIKEY': this.apiKey,
          },
        })
        .toPromise();
    }
  }

  async withdrawEnableAlert() {
    if (!this.withdrawEnableHandle) {
      this.withdrawEnableHandle = setTimeout(() => {
        clearTimeout(this.withdrawEnableHandle);
        this.withdrawEnableHandle = null;
      }, 3000);

      let result = await this.httpClient
        .get<any>(`http://192.168.1.16:4000/orders/alert/withdraw/enable`, {
          headers: {},
        })
        .toPromise();
    }
  }
}
