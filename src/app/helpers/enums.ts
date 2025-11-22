export type MagicNumber = string;
export type Token = string;
export type OrderId = string | number;
export type Quantity = number;
export type Price = number;
export type EpochTime = number;

export enum Locale {
  ENGLISH_US = 'en-US',
}

export enum MessageTypes {
  MARKET_DEPTH_MESSAGE_EVENT = 'MARKET_DEPTH_MESSAGE_EVENT',
  APP_READY_EVENT = 'APP_READY_EVENT',
  APP_ARBITRAGE_BOOK_SYMBOL_CHANGE_EVENT = 'APP_ARBITRAGE_BOOK_SYMBOL_CHANGE_EVENT',
  ARBITRAGE_UPDATE_EVENT = 'ARBITRAGE_CHANGE_UPDATE_EVENT',
  ARBITRAGE_ORDER_EVENT = 'ARBITRAGE_ORDER_EVENT',
  ARBITRAGE_PROFIT_MARKET_ALERT = 'ARBITRAGE_PROFIT_MARKET_ALERT',
  ARBITRAGE_PROFIT_LIMIT_ALERT = 'ARBITRAGE_PROFIT_LIMIT_ALERT',
  ORDER_UPDATE_EVENT = 'ORDER_UPDATE_EVENT',
  BALANCE_UPDATE_EVENT = 'BALANCE_UPDATE_EVENT',
  BALANCE_REFRESH_EVENT = 'BALANCE_REFRESH_EVENT',
  ORDER_PARTIAL_FILL_EVENT = 'ORDER_PARTIAL_FILL_EVENT',
  GET_ALL_OPEN_ORDERS_EVENT = 'GET_ALL_ORDERS_EVENT',
  CANCEL_ORDER_EVENT = 'CANCEL_ORDER_EVENT',
  GET_BALANCE_EVENT = 'GET_BALANCE_EVENT',
  WITHDRAW_COIN_EVENT = 'WITHDRAW_COIN_EVENT',
  WITHDRAW_ENABLE_ALERT = 'WITHDRAW_ENABLE_ALERT',
  COIN_UPDATE_EVENT = 'COIN_UPDATE_EVENT',
  ARBITRAGE_AUTO_ORDER_CLEARED = 'ARBITRAGE_AUTO_ORDER_CLEARED',
}

export enum HTTPMethods {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  DELETE = 'DELETE',
}

export enum ArbitrageBaseSymbol {
  XRP = 'XRP',
  USDT = 'USDT',
}

export enum Segment {
  None = 0,
  NSE = 1,
  NFO = 2,
  CDS = 3,
  MCX = 31,
  Binance = 41,
  Wazirx = 42,
  BiTrue = 43,
  Sologenic = 44,
  BitForex = 45,
  GateIO = 46,
  MEXC = 47,
}

export enum OrderQuantityCalculationMode {
  None = 0,
  Quantity = 1,
  Volume = 2,
  Percentage = 3,
}

export enum SymbolType {
  None = 0,
  EQUITY = 1,
  FUTURE = 2,
  OPTION = 3,
  SPOT = 4,
  CRYPTO = 5,
}

export enum Series {
  NONE = 0,
  EQ = 1,
  FUTIDX = 2,
  FUTSTK = 3,
  OPTIDX = 4,
  OPTSTK = 5,
  FUTCOM = 31,
  FUTCUR = 32,
}

export enum TransactionType {
  None = 0,
  Buy = 1,
  Sell = 2,
  Short = 3,
  Cover = 4,
  BuyCover = 5,
  SellShort = 6,
  CoverAll = 7,
  SellAll = 8,
  SquareOff = 9,
}

export enum ProductType {
  None = 0,
  MIS = 1,
  NRML = 2,
  CNC = 3,
  CO = 4,
  BRACKET = 5,
  Margin = 21,
  Intraday = 22,
  CarryForward = 23,
}

export enum TradeInterface {
  None = 0,
  // NestTws = 1,
  // NESTComApi = 2,
  // NowTws = 11,
  // Odin = 21,
  BinanceApi = 31,
  KiteApi = 41,
  WazirxApi = 51,
  BiTrueApi = 61,
  SologenicApi = 71,
  BitForexApi = 72,
  GateIOApi = 73,
  MEXCApi = 74,
}

export enum OptionType {
  None = 0,
  CE = 1,
  PE = 2,
}

export enum OrderType {
  None = 0,
  Limit = 1,
  Market = 2,
  StopLoss = 3,
  StopLossLimit = 4,
  TakeProfit = 5,
  TakeProfitLimit = 6,
  LimitMaker = 7,
  ImmediateOrCancel = 8,
  FillOrKill = 9,
  IOC = 10,
}

export enum OrderValidity {
  None = 0,
  Day = 1,
  IOC = 2,
}

export enum OrderStatus {
  None = 0,
  TerminalReceived = 1,
  Pending = 2,
  New = 3,
  PartiallyFilled = 4,
  Filled = 5,
  Cancelled = 6,
  PendingCancel = 7,
  Rejected = 8,
  Expired = 9,
  PartiallyCanceled = 10,
}

export enum OrderMode {
  None = 0,
  New = 1,
  Modify = 2,
  Cancel = 3,
}

export enum StrategyRunningState {
  None = 0,
  Running = 1,
  Stopped = 2,
  Paused = 3,
}

export enum Mode {
  None = 0,
  Live = 1,
  Simulation = 2,
}

export enum Timeframe {
  None = 0,
  Minute = 1,
  Hour = 2,
  Day = 3,
  Week = 4,
  Month = 5,
}

export enum StrategyExceptionSource {
  OnTick,
  OnBar,
  OnStop,
  OnResume,
  OnPause,
  OnStart,
}

export enum PositionCalculationMode {
  Orders = 1,
  Trades = 2,
}

export enum RestRequestType {
  None = 0,
  GetPositionByMagicNumber = 1,
}

export enum KiteResponseStatus {
  None = 0,
  Success = 1,
  Error = 2,
}

export enum KiteOrderVariety {
  None = 0,
  AMO = 1,
  REGULAR = 2,
  CO = 3,
}

export enum TradeSystemPrefix {
  ARBITRAGE = 'ARBITRAGE',
  MANUAL = 'MANUAL',
  STEP_UP_SELL_TRADE = 'STEP_UP_SELL_TRADE',
}

import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'enumToString',
})
export class EnumAsStringPipe implements PipeTransform {
  transform(value: number, enumType: any): any {
    return enumType[value]
      .split(/(?=[A-Z])/)
      .join()
      .replace(',', '');
  }
}

@Pipe({
  name: 'enumToArray',
})
export class EnumToArrayPipe implements PipeTransform {
  transform(data: Object) {
    const keys = Object.keys(data);
    return Object.keys(data)
      .slice(keys.length / 2)
      .filter((item) => {
        return item != 'None';
      });
  }
}
