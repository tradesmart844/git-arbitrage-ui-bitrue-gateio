import { MessageTypes } from '../helpers/enums';
import { AccountBalance } from '../models/account-balance';

export interface MessageDataInterface<T> {
  MessageType: MessageTypes;
  Data: T;
}

export interface WithdrawBalance {
  balance: AccountBalance;
  amount: number;
}
