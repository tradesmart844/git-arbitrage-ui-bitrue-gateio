import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { TableModule } from 'primeng/table';
import { SplitterModule } from 'primeng/splitter';
import { ButtonModule } from 'primeng/button';
import { TabViewModule } from 'primeng/tabview';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputNumberModule } from 'primeng/inputnumber';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';

import { AppComponent } from './app.component';
import { EnumAsStringPipe, EnumToArrayPipe } from './helpers/enums';
import { MarketDepthComponent } from './components/market-depth/market-depth.component';
import { BalanceComponent } from './components/balance/balance.component';
import { ArbitrageBookComponent } from './components/arbitrage-book/arbitrage-book.component';
import { ArbitrageCurrentComponent } from './components/arbitrage-current/arbitrage-current.component';
import { OrderbookComponent } from './components/orderbook/orderbook.component';
import { ExtraComponent } from './components/extra/extra.component';
import { WithdrawCoinComponent } from './components/withdraw-coin/withdraw-coin.component';
import { TotalCoinBalanceComponent } from './components/total-coin-balance/total-coin-balance.component';
import { ArbitrageAutoOrderService } from './services/arbitrage-auto-order.service';

@NgModule({
  declarations: [
    AppComponent,
    EnumAsStringPipe,
    EnumToArrayPipe,
    MarketDepthComponent,
    BalanceComponent,
    ArbitrageBookComponent,
    ArbitrageCurrentComponent,
    OrderbookComponent,
    ExtraComponent,
    WithdrawCoinComponent,
    TotalCoinBalanceComponent,
  ],
  imports: [
    BrowserModule,
    TableModule,
    HttpClientModule,
    FormsModule,
    BrowserAnimationsModule,
    SplitterModule,
    ButtonModule,
    TabViewModule,
    DialogModule,
    DropdownModule,
    InputNumberModule,
    ToastModule
  ],
  //entryComponents: [AddStrategyComponent],
  providers: [MessageService, ArbitrageAutoOrderService],
  bootstrap: [AppComponent],
})
export class AppModule { }
