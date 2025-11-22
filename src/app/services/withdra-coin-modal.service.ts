import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { AccountBalance } from '../models/account-balance';

@Injectable({
  providedIn: 'root',
})
export class WithdraCoinModalService {
  private isModalOpen = new Subject<boolean>(); // Observable to track modal state
  private balance: AccountBalance | undefined; // Store data to be passed to modal component

  openModal(balance: AccountBalance) {
    this.isModalOpen.next(true);
    this.balance = balance; // Optional: Store data for modal access
  }

  closeModal() {
    this.isModalOpen.next(false);
    this.balance = undefined; // Clear data when closing
  }

  getIsModalOpen() {
    return this.isModalOpen.asObservable();
  }

  getModalData() {
    return this.balance; // Access data in modal component if needed
  }
}
