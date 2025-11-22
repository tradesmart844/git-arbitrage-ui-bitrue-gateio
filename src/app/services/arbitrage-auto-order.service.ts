import { Injectable, Output } from '@angular/core';
import { ArbitrageService } from './arbitrage.service';
import { ArbitragePair } from '../models/arbitrage-pair';
import { MessageTypes, OrderStatus, TradeInterface, TransactionType, OrderType } from '../helpers/enums';
import { MessageDataInterface } from '../interfaces/message-data-interface';
import { EventEmitter } from '@angular/core';
import { Subscription } from 'rxjs';
import { HelperUtil } from '../helpers/helper-util';
import { OrderService } from './order.service';
import { IOrder } from '../interfaces/order-interface';
import { cloneDeep } from 'lodash';
import { AppService } from './app.service';
import { LocalStorageService } from './local-storage.service';
import { MexcApiInteractiveService } from './mexc-api-interactive.service';
import { BitrueInteractiveService } from './bitrue-interactive.service';
import { Order } from '../models/order';
import { SymbolManagerService } from './symbol-manager.service';
import { ISymbol } from '../interfaces/symbol-interface';
import { SymbolCrypto } from '../models/symbol-crypto';

// Interface to track order execution status for each arbitrage pair
interface OrderTrackingData {
    sellOrders: IOrder[];
    buyOrders: IOrder[];
    sellFilledQuantity: number;
    buyFilledQuantity: number;
    sellRemainingQuantity: number;
    buyRemainingQuantity: number;
    lastCheckedTime: number;
    waitingTime: number;
    isExiting: boolean;
    // Fields for market volatility management
    initialProfitPercent: number;    // Initial profit percentage when trade was started
    retryCount: number;              // Number of retry attempts for price adjustment
    lastAdjustedPrice: number;       // Last price used for order placement
    priceAdjustmentPercent: number;  // Current price adjustment percentage
    // Fields to track historical fills
    cumulativeSellFilledQuantity: number; // Total filled quantity including from canceled orders
    cumulativeBuyFilledQuantity: number;  // Total filled quantity including from canceled orders
    lastCanceledSellOrder: IOrder | null; // Last canceled sell order with partial fills
    lastCanceledBuyOrder: IOrder | null;  // Last canceled buy order with partial fills
}

@Injectable({
    providedIn: 'root'
})
export class ArbitrageAutoOrderService {
    @Output() autoOrderEvents: EventEmitter<MessageDataInterface<any>> = new EventEmitter<MessageDataInterface<any>>();

    private arbitragePairs: Map<string, ArbitragePair> = new Map<string, ArbitragePair>();
    private processingArbitragePairs: Map<string, ArbitragePair> = new Map<string, ArbitragePair>();
    private orderTrackingData: Map<string, OrderTrackingData> = new Map<string, OrderTrackingData>();
    private appSubscription: Subscription | undefined;
    private readonly STORAGE_KEY = 'processing_arbitrage_pairs';
    private orderManagementTimers: Map<string, any> = new Map<string, any>();
    private enableAutoOrderManagement: boolean = false; // Flag to enable/disable auto order management

    constructor(
        private orderService: OrderService,
        private appService: AppService,
        private arbitrageService: ArbitrageService,
        private localStorageService: LocalStorageService,
        private mexcApiInteractiveService: MexcApiInteractiveService,
        private bitrueInteractiveService: BitrueInteractiveService,
        private symbolManagerService: SymbolManagerService
    ) {
        this.initializeSubscriptions();
        this.restoreProcessingArbitragePairs();
    }

    private async restoreProcessingArbitragePairs(): Promise<void> {
        try {
            const storedPairs = await this.localStorageService.getItem(this.STORAGE_KEY);
            if (storedPairs) {
                // Convert stored objects back to ArbitragePair instances
                const restoredPairs = storedPairs.map((pair: any) => {
                    const arbitragePair = new ArbitragePair(
                        pair.sellMarketDataContainer,
                        pair.buyMarketDataContainer,
                        pair.conversionSideMarketContainer,
                        pair.sellQuantity,
                        pair.buyQuantity,
                        pair.conversionQuantity,
                        pair.targetPer,
                        pair.isMarketAlert,
                        pair.isLimitAlert,
                        pair.extraBuyQuantity,
                        pair.calculateSellQuantityValue,
                        pair.placeOrderViaWeb,
                        pair.placeAutoBuyOrder
                    );
                    // Restore additional properties
                    arbitragePair.magicNumber = pair.magicNumber;
                    arbitragePair.isBeingProcessed = pair.isBeingProcessed;
                    return arbitragePair;
                });

                // Add restored pairs to the processing map only
                restoredPairs.forEach((pair: ArbitragePair) => {
                    this.processingArbitragePairs.set(pair.magicNumber, pair);

                    // Initialize order tracking data for each pair
                    this.initializeOrderTrackingData(pair.magicNumber);

                    // Start order management for each pair if auto management is enabled
                    if (this.enableAutoOrderManagement) {
                        this.startOrderManagement(pair.magicNumber);
                    }
                });

                console.log('Restored processing arbitrage pairs:', {
                    count: restoredPairs.length,
                    pairs: restoredPairs.map((p: ArbitragePair) => ({
                        symbol: p.sellMarketDataContainer.symbol.token,
                        magicNumber: p.magicNumber
                    }))
                });
            }
        } catch (error) {
            console.error('Error restoring processing arbitrage pairs:', error);
        }
    }

    private async persistProcessingArbitragePairs(): Promise<void> {
        try {
            const pairsToStore = Array.from(this.processingArbitragePairs.values());
            await this.localStorageService.setItem(this.STORAGE_KEY, pairsToStore);
            console.log('Persisted processing arbitrage pairs:', {
                count: pairsToStore.length,
                pairs: pairsToStore.map(p => ({
                    symbol: p.sellMarketDataContainer.symbol.token,
                    magicNumber: p.magicNumber
                }))
            });
        } catch (error) {
            console.error('Error persisting processing arbitrage pairs:', error);
        }
    }

    private initializeSubscriptions(): void {
        // Subscribe to arbitrage profit market alerts from appService
        this.appSubscription = this.appService.appEvents.subscribe(
            (message: MessageDataInterface<any>) => {
                if (message.MessageType === MessageTypes.ARBITRAGE_PROFIT_MARKET_ALERT) {
                    this.handleArbitrageAlert.bind(this)(message.Data as ArbitragePair);
                }
            }
        );
    }

    private handleArbitrageAlert(arbitragePair: ArbitragePair): void {
        if (!arbitragePair.placeAutoBuyOrder) {
            return;
        }

        //Clone the arbitrage pair
        let arbitragePairClone = cloneDeep(arbitragePair);

        // Check if this arbitrage pair is already being processed to prevent duplicates
        if (this.arbitragePairs.has(arbitragePairClone.getUniqueKey())) {
            return;
        }

        this.arbitragePairs.set(arbitragePairClone.getUniqueKey(), arbitragePairClone);

        //Check for available batches
        if (this.arbitrageService.getAvailableBatches(arbitragePairClone) === 0 || this.arbitrageService.getAvailableSellBatches(arbitragePairClone) === 0) {
            console.log('No available batches for arbitrage pair:', arbitragePairClone.getUniqueKey());
            return;
        }

        // Generate a unique magic number for this arbitrage pair
        let magicNumber = 't-' + HelperUtil.generateRandomAlphanumeric(27);
        arbitragePairClone.magicNumber = magicNumber;
        arbitragePairClone.isBeingProcessed = true;

        this.processingArbitragePairs.set(arbitragePairClone.magicNumber, arbitragePairClone);

        // Initialize order tracking data
        this.initializeOrderTrackingData(magicNumber);

        // Store the initial profit percentage for later reference in price adjustments
        const trackingData = this.orderTrackingData.get(magicNumber)!;
        trackingData.initialProfitPercent = arbitragePairClone.profitPerAtMarketPrice;

        // Start order management if enabled
        if (this.enableAutoOrderManagement) {
            this.startOrderManagement(magicNumber);
        }

        // Emit event for UI updates
        this.autoOrderEvents.emit({
            MessageType: MessageTypes.ARBITRAGE_ORDER_EVENT,
            Data: arbitragePairClone
        });

        // Log the arbitrage opportunity
        console.log('New arbitrage opportunity detected:', {
            symbol: arbitragePairClone.sellMarketDataContainer.symbol.token,
            profitPercentage: arbitragePairClone.profitPerAtMarketPrice,
            magicNumber: magicNumber
        });

        // Place both sell and buy orders
        this.executeArbitrageOrders(arbitragePairClone);
    }

    private async executeArbitrageOrders(arbitragePair: ArbitragePair): Promise<void> {
        try {
            // Quick price re-check before placing orders
            await this.checkMarketPriceBeforeExecution(arbitragePair);

            // Place sell and buy orders concurrently
            await Promise.all([
                this.placeSellOrder(arbitragePair),
                this.placeBuyOrder(arbitragePair)
            ]);

            // Persist the updated processing pairs
            await this.persistProcessingArbitragePairs();

            console.log('Arbitrage orders placed concurrently and added to processing list:', {
                symbol: arbitragePair.sellMarketDataContainer.symbol.token,
                magicNumber: arbitragePair.magicNumber
            });

            // Remove the pair from arbitragePairs map after a delay
            setTimeout(() => {
                this.arbitragePairs.delete(arbitragePair.getUniqueKey());
                console.log('Removed arbitrage pair from arbitragePairs map:', {
                    symbol: arbitragePair.sellMarketDataContainer.symbol.token,
                    magicNumber: arbitragePair.magicNumber
                });
            }, 3000);

        } catch (error) {
            console.error('Error executing arbitrage orders:', error);
            this.cleanupArbitragePair(arbitragePair);
        }
    }

    // Check market price before execution to avoid unprofitable trades
    private async checkMarketPriceBeforeExecution(arbitragePair: ArbitragePair): Promise<void> {
        // Get latest market data
        const sellSymbol = arbitragePair.sellMarketDataContainer.symbol;
        const buySymbol = arbitragePair.buyMarketDataContainer.symbol;

        // Recalculate the current profit percentage
        const currentSellPrice = arbitragePair.sellMarketDataContainer.marketDepths.getBestPriceByQuantity(
            TransactionType.Sell,
            arbitragePair.sellQuantity
        );

        const currentBuyPrice = arbitragePair.buyMarketDataContainer.marketDepths.getBestPriceByQuantity(
            TransactionType.Buy,
            arbitragePair.buyQuantity
        );

        if (currentSellPrice <= 0 || currentBuyPrice <= 0) {
            throw new Error("Unable to get current market prices for pre-execution check");
        }

        // Calculate current profit
        const currentProfit = ((currentSellPrice - currentBuyPrice) / currentBuyPrice) * 100;

        // Get tracking data to store initial profit
        const trackingData = this.orderTrackingData.get(arbitragePair.magicNumber)!;
        trackingData.initialProfitPercent = currentProfit;

        // Check if profit is still above threshold (minimum 0.2% profit)
        if (currentProfit < 0.2) {
            console.warn(`Market conditions changed - profit dropped from ${arbitragePair.profitPerAtMarketPrice.toFixed(2)}% to ${currentProfit.toFixed(2)}%. Canceling trade.`);
            throw new Error("Profit margin below threshold due to market volatility");
        }

        // Update arbitrage pair with current prices
        arbitragePair.sellMarketPrice = currentSellPrice;
        arbitragePair.buyMarketPrice = currentBuyPrice;
        arbitragePair.profitPerAtMarketPrice = currentProfit;

        console.log(`Pre-execution market check: Current profit at ${currentProfit.toFixed(2)}%, proceeding with trade`);
    }

    /**
     * Normalizes the order quantity according to exchange precision requirements
     * @param symbol The trading symbol containing precision information
     * @param quantity The original quantity to normalize
     * @returns The normalized quantity that adheres to exchange precision rules
     */
    private normalizeQuantity(symbol: ISymbol, quantity: number): number {
        // Get the appropriate precision for the quantity based on the exchange
        let precision: number;

        // Exchange-specific precision rules
        if (symbol.tradeInterface === TradeInterface.MEXCApi) {
            // MEXC uses baseAssetPrecision
            // The lotSize already contains this information from when the symbols were loaded
            precision = Math.log10(1 / symbol.lotSize);
        } else if (symbol.tradeInterface === TradeInterface.BiTrueApi) {
            // Bitrue uses specific step sizes defined in their filters
            // The lotSize already contains this information from when the symbols were loaded
            precision = Math.log10(1 / symbol.lotSize);
        } else {
            // Default to 4 decimal places if unknown
            precision = 4;
        }

        // Round to the appropriate number of decimal places
        const normalizedQuantity = parseFloat(quantity.toFixed(precision));

        console.log(`Normalized quantity for ${symbol.token} from ${quantity} to ${normalizedQuantity} (precision: ${precision})`);

        return normalizedQuantity;
    }

    /**
     * Normalizes the order price according to exchange precision requirements (tickSize)
     * @param symbol The trading symbol containing precision information
     * @param price The original price to normalize
     * @returns The normalized price that adheres to exchange precision rules
     */
    private normalizePrice(symbol: ISymbol, price: number): number {
        if (price <= 0 || symbol.tickSize <= 0) {
            return price; // Cannot normalize invalid price or tickSize
        }

        const precision = -Math.log10(symbol.tickSize);

        // Ensure precision is a non-negative integer
        const decimalPlaces = Math.max(0, Math.ceil(precision));

        const normalizedPrice = parseFloat(price.toFixed(decimalPlaces));

        this.logWithTimestamp(`Normalized price for ${symbol.token} from ${price} to ${normalizedPrice} (tickSize: ${symbol.tickSize}, decimalPlaces: ${decimalPlaces})`);

        return normalizedPrice;
    }

    private async placeSellOrder(arbitragePair: ArbitragePair): Promise<void> {
        try {
            const symbol = arbitragePair.sellMarketDataContainer.symbol;
            const price = arbitragePair.sellMarketPrice;

            // Normalize the quantity according to exchange precision requirements
            const quantity = this.normalizeQuantity(symbol, arbitragePair.sellQuantity);

            // Check minimum order value for MEXC
            if (symbol.tradeInterface === TradeInterface.MEXCApi) {
                const orderValue = price * quantity;
                if (orderValue < 1) {
                    console.warn(`MEXC sell order value (${orderValue.toFixed(2)} USDT) is below minimum threshold of 1 USDT. Skipping trade for ${arbitragePair.magicNumber}.`);
                    throw new Error("Order value below MEXC minimum threshold");
                }
            }

            // Check minimum order value for Bitrue
            if (symbol.tradeInterface === TradeInterface.BiTrueApi) {
                const orderValue = price * quantity;
                if (orderValue < 10) {
                    console.warn(`Bitrue sell order value (${orderValue.toFixed(2)} USDT) is below minimum threshold of 10 USDT. Skipping trade for ${arbitragePair.magicNumber}.`);
                    throw new Error("Order value below Bitrue minimum threshold");
                }
            }

            // Update the arbitrage pair with the normalized quantity
            arbitragePair.sellQuantity = quantity;

            await this.arbitrageService.placeMarketOrder(arbitragePair);

            console.log('Sell order placed:', {
                symbol: symbol.token,
                quantity: quantity,
                price: price,
                magicNumber: arbitragePair.magicNumber
            });
        } catch (error) {
            console.error('Error placing sell order:', error);
            throw error; // Propagate error to handle in executeArbitrageOrders
        }
    }

    private async placeBuyOrder(arbitragePair: ArbitragePair): Promise<void> {
        try {
            const symbol = arbitragePair.buyMarketDataContainer.symbol;
            const price = arbitragePair.buyMarketPrice;

            // Normalize the quantity according to exchange precision requirements
            const rawQuantity = arbitragePair.sellQuantity + arbitragePair.extraBuyQuantity;
            const quantity = this.normalizeQuantity(symbol, rawQuantity);

            // Check minimum order value for MEXC
            if (symbol.tradeInterface === TradeInterface.MEXCApi) {
                const orderValue = price * quantity;
                if (orderValue < 1) {
                    console.warn(`MEXC buy order value (${orderValue.toFixed(2)} USDT) is below minimum threshold of 1 USDT. Skipping trade for ${arbitragePair.magicNumber}.`);
                    throw new Error("Order value below MEXC minimum threshold");
                }
            }

            // Check minimum order value for Bitrue
            if (symbol.tradeInterface === TradeInterface.BiTrueApi) {
                const orderValue = price * quantity;
                if (orderValue < 10) {
                    console.warn(`Bitrue buy order value (${orderValue.toFixed(2)} USDT) is below minimum threshold of 10 USDT. Skipping trade for ${arbitragePair.magicNumber}.`);
                    throw new Error("Order value below Bitrue minimum threshold");
                }
            }

            // Update arbitrage pair with normalized quantity for any future reference
            arbitragePair.buyQuantity = quantity;

            await this.arbitrageService.crossBuy(arbitragePair);

            console.log('Buy order placed:', {
                symbol: symbol.token,
                quantity: quantity,
                price: price,
                magicNumber: arbitragePair.magicNumber
            });
        } catch (error) {
            console.error('Error placing buy order:', error);
            throw error; // Propagate error to handle in executeArbitrageOrders
        }
    }

    private cleanupArbitragePair(arbitragePair: ArbitragePair): void {
        arbitragePair.isBeingProcessed = false;

        // Stop and remove the order management timer
        if (this.orderManagementTimers.has(arbitragePair.magicNumber)) {
            clearTimeout(this.orderManagementTimers.get(arbitragePair.magicNumber));
            this.orderManagementTimers.delete(arbitragePair.magicNumber);
        }

        // Remove from tracking
        this.orderTrackingData.delete(arbitragePair.magicNumber);

        // Remove from processing pairs
        this.processingArbitragePairs.delete(arbitragePair.magicNumber);

        // Persist changes
        this.persistProcessingArbitragePairs();
    }

    public cleanup(): void {
        // Stop all order management timers
        this.orderManagementTimers.forEach((timer) => {
            clearTimeout(timer);
        });
        this.orderManagementTimers.clear();

        if (this.appSubscription) {
            this.appSubscription.unsubscribe();
        }
        this.arbitragePairs.clear();
        this.processingArbitragePairs.clear();
        this.orderTrackingData.clear();
        this.localStorageService.removeItem(this.STORAGE_KEY);
    }

    private initializeOrderTrackingData(magicNumber: string): void {
        this.orderTrackingData.set(magicNumber, {
            sellOrders: [],
            buyOrders: [],
            sellFilledQuantity: 0,
            buyFilledQuantity: 0,
            sellRemainingQuantity: 0,
            buyRemainingQuantity: 0,
            lastCheckedTime: Date.now(),
            waitingTime: 0,
            isExiting: false,
            // Initialize market volatility management fields
            initialProfitPercent: 0,
            retryCount: 0,
            lastAdjustedPrice: 0,
            priceAdjustmentPercent: 0,
            // Initialize historical tracking fields
            cumulativeSellFilledQuantity: 0,
            cumulativeBuyFilledQuantity: 0,
            lastCanceledSellOrder: null,
            lastCanceledBuyOrder: null
        });
    }

    // Toggle auto order management
    public toggleAutoOrderManagement(enable: boolean): void {
        this.enableAutoOrderManagement = enable;

        // Start or stop order management for all processing pairs
        if (enable) {
            Array.from(this.processingArbitragePairs.keys()).forEach(magicNumber => {
                this.startOrderManagement(magicNumber);
            });
        } else {
            // Clear all timers
            this.orderManagementTimers.forEach((timer, magicNumber) => {
                clearTimeout(timer);
            });
            this.orderManagementTimers.clear();
        }
    }

    // Clear all processing arbitrage pairs
    public clearAllProcessingPairs(): void {
        // Cancel all open orders first
        Array.from(this.processingArbitragePairs.keys()).forEach(async magicNumber => {
            try {
                await this.cancelAllOrders(magicNumber);
            } catch (error) {
                console.error(`Error canceling orders for ${magicNumber}:`, error);
            }
        });

        // Clear all timers
        this.orderManagementTimers.forEach((timer, magicNumber) => {
            clearTimeout(timer);
        });
        this.orderManagementTimers.clear();

        // Clear all tracking data and processing pairs
        this.orderTrackingData.clear();
        this.processingArbitragePairs.clear();
        this.arbitragePairs.clear();

        // Persist empty state
        this.persistProcessingArbitragePairs();

        console.log('All processing arbitrage pairs have been cleared');

        // Emit event to notify UI of change
        this.autoOrderEvents.emit({
            MessageType: MessageTypes.ARBITRAGE_AUTO_ORDER_CLEARED,
            Data: null
        });
    }

    // Get the count of currently processing arbitrage pairs
    public getProcessingPairsCount(): number {
        return this.processingArbitragePairs.size;
    }

    // Start order management for a specific arbitrage pair
    private startOrderManagement(magicNumber: string): void {
        // Clear any existing timer
        if (this.orderManagementTimers.has(magicNumber)) {
            clearTimeout(this.orderManagementTimers.get(magicNumber));
        }

        // Set a new timer to run order management every 5 seconds
        const timer = setTimeout(() => {
            this.manageOrders(magicNumber).then(() => {
                // If the pair is still being processed, start the next timer
                if (this.processingArbitragePairs.has(magicNumber) && this.enableAutoOrderManagement) {
                    this.startOrderManagement(magicNumber);
                }
            });
        }, 5000);

        this.orderManagementTimers.set(magicNumber, timer);
    }

    // Main order management logic
    private async manageOrders(magicNumber: string): Promise<void> {
        if (!this.processingArbitragePairs.has(magicNumber) || !this.orderTrackingData.has(magicNumber)) {
            // Clean up if the pair is no longer being processed
            if (this.orderManagementTimers.has(magicNumber)) {
                clearTimeout(this.orderManagementTimers.get(magicNumber));
                this.orderManagementTimers.delete(magicNumber);
            }
            return;
        }

        const arbitragePair = this.processingArbitragePairs.get(magicNumber)!;
        const trackingData = this.orderTrackingData.get(magicNumber)!;

        this.logWithTimestamp(`[AUTO_ORDER] [${magicNumber}] Starting order management cycle for ${arbitragePair.sellMarketDataContainer.symbol.token}`);

        try {
            // Fetch the latest orders for this arbitrage pair
            await this.fetchOrdersForPair(arbitragePair);

            // Calculate filled and remaining quantities
            this.calculateOrderQuantities(magicNumber);

            // Check order status and take appropriate action
            await this.manageOrderStatus(magicNumber);

            // Update the last checked time
            trackingData.lastCheckedTime = Date.now();
        } catch (error) {
            console.error(`Error managing orders for pair ${magicNumber}:`, error);
        }
    }

    // Fetch orders for a specific arbitrage pair using historical API endpoints
    private async fetchOrdersForPair(arbitragePair: ArbitragePair): Promise<void> {
        const magicNumber = arbitragePair.magicNumber;
        const trackingData = this.orderTrackingData.get(magicNumber)!;
        const startTime = arbitragePair.createdTime; // Use the pair creation time as the start
        const timeBuffer = 5000; // Add a small buffer to startTime just in case

        // Store previous order states for comparison
        const previousSellOrders = [...trackingData.sellOrders];
        const previousBuyOrders = [...trackingData.buyOrders];

        try {
            const sellSymbol = arbitragePair.sellMarketDataContainer.symbol;
            const buySymbol = arbitragePair.buyMarketDataContainer.symbol;

            // Fetch historical orders for the sell side
            let allSellOrders: IOrder[] = [];
            if (sellSymbol.tradeInterface === TradeInterface.MEXCApi) {
                allSellOrders = await this.mexcApiInteractiveService.getAllOrdersBySymbolAndTime(sellSymbol.token, startTime - timeBuffer);
            } else if (sellSymbol.tradeInterface === TradeInterface.BiTrueApi) {
                allSellOrders = await this.bitrueInteractiveService.getAllOrdersBySymbolAndTime(sellSymbol.token, startTime - timeBuffer);
            } else {
                console.warn(`[AUTO_ORDER] [${magicNumber}] Unsupported trade interface for fetching sell orders: ${TradeInterface[sellSymbol.tradeInterface]}`);
            }

            // Fetch historical orders for the buy side
            let allBuyOrders: IOrder[] = [];
            if (buySymbol.tradeInterface === TradeInterface.MEXCApi) {
                allBuyOrders = await this.mexcApiInteractiveService.getAllOrdersBySymbolAndTime(buySymbol.token, startTime - timeBuffer);
            } else if (buySymbol.tradeInterface === TradeInterface.BiTrueApi) {
                allBuyOrders = await this.bitrueInteractiveService.getAllOrdersBySymbolAndTime(buySymbol.token, startTime - timeBuffer);
            } else {
                console.warn(`[AUTO_ORDER] [${magicNumber}] Unsupported trade interface for fetching buy orders: ${TradeInterface[buySymbol.tradeInterface]}`);
            }

            // Log the magic number being used for filtering
            this.logWithTimestamp(`[${magicNumber}] Filtering orders using magicNumber prefix: ${magicNumber}`);

            // Filter the fetched orders based on the magicNumber prefix
            const sellOrders = allSellOrders.filter(order =>
                order.clientOrderId?.startsWith(magicNumber)
            );

            const buyOrders = allBuyOrders.filter(order =>
                order.clientOrderId?.startsWith(magicNumber)
            );

            this.logWithTimestamp(`[${magicNumber}] Fetched historical orders via API and filtered`, {
                rawSellCount: allSellOrders.length,
                rawBuyCount: allBuyOrders.length,
                filteredSellCount: sellOrders.length,
                filteredBuyCount: buyOrders.length,
                sellOrders: sellOrders.map(o => ({ id: o.orderId, cId: o.clientOrderId, status: OrderStatus[o.orderStatus], filled: o.filledQuantity, time: o.orderTime })),
                buyOrders: buyOrders.map(o => ({ id: o.orderId, cId: o.clientOrderId, status: OrderStatus[o.orderStatus], filled: o.filledQuantity, time: o.orderTime }))
            });

            // Update tracking data
            trackingData.sellOrders = sellOrders;
            trackingData.buyOrders = buyOrders;

            // Log changes in order state
            this.logOrderChanges(magicNumber, previousSellOrders, previousBuyOrders, sellOrders, buyOrders);

        } catch (error) {
            console.error(`[AUTO_ORDER] [${magicNumber}] Error fetching historical orders via API:`, error);
            // Keep existing orders in case of fetch error
            trackingData.sellOrders = previousSellOrders;
            trackingData.buyOrders = previousBuyOrders;
        }
    }

    // Helper method to log changes in order state
    private logOrderChanges(
        magicNumber: string,
        previousSellOrders: IOrder[],
        previousBuyOrders: IOrder[],
        currentSellOrders: IOrder[],
        currentBuyOrders: IOrder[]
    ): void {
        // Get current tracking data
        const trackingData = this.orderTrackingData.get(magicNumber)!;
        const timestamp = new Date().toISOString();

        // Check for new orders
        const newSellOrders = currentSellOrders.filter(current =>
            !previousSellOrders.some(prev => prev.orderId === current.orderId));

        const newBuyOrders = currentBuyOrders.filter(current =>
            !previousBuyOrders.some(prev => prev.orderId === current.orderId));

        // Check for removed orders (canceled or filled)
        const removedSellOrders = previousSellOrders.filter(prev =>
            !currentSellOrders.some(current => current.orderId === prev.orderId));

        const removedBuyOrders = previousBuyOrders.filter(prev =>
            !currentBuyOrders.some(current => current.orderId === prev.orderId));

        // Check for status changes
        const changedSellOrders = currentSellOrders.filter(current => {
            const prevOrder = previousSellOrders.find(prev => prev.orderId === current.orderId);
            return prevOrder && (
                prevOrder.orderStatus !== current.orderStatus ||
                prevOrder.filledQuantity !== current.filledQuantity
            );
        });

        const changedBuyOrders = currentBuyOrders.filter(current => {
            const prevOrder = previousBuyOrders.find(prev => prev.orderId === current.orderId);
            return prevOrder && (
                prevOrder.orderStatus !== current.orderStatus ||
                prevOrder.filledQuantity !== current.filledQuantity
            );
        });

        // Log significant changes
        if (newSellOrders.length > 0) {
            console.log(`[${timestamp}] [AUTO_ORDER] [${magicNumber}] New sell orders detected:`, newSellOrders.map(o => ({
                orderId: o.orderId,
                status: OrderStatus[o.orderStatus],
                qty: o.quantity,
                filled: o.filledQuantity
            })));
        }

        if (newBuyOrders.length > 0) {
            console.log(`[${timestamp}] [AUTO_ORDER] [${magicNumber}] New buy orders detected:`, newBuyOrders.map(o => ({
                orderId: o.orderId,
                status: OrderStatus[o.orderStatus],
                qty: o.quantity,
                filled: o.filledQuantity
            })));
        }

        if (removedSellOrders.length > 0) {
            console.log(`[${timestamp}] [AUTO_ORDER] [${magicNumber}] Sell orders no longer present:`, removedSellOrders.map(o => ({
                orderId: o.orderId,
                lastStatus: OrderStatus[o.orderStatus],
                qty: o.quantity,
                filled: o.filledQuantity
            })));
        }

        if (removedBuyOrders.length > 0) {
            console.log(`[${timestamp}] [AUTO_ORDER] [${magicNumber}] Buy orders no longer present:`, removedBuyOrders.map(o => ({
                orderId: o.orderId,
                lastStatus: OrderStatus[o.orderStatus],
                qty: o.quantity,
                filled: o.filledQuantity
            })));
        }

        if (changedSellOrders.length > 0) {
            changedSellOrders.forEach(current => {
                const prev = previousSellOrders.find(p => p.orderId === current.orderId)!;
                console.log(`[${timestamp}] [AUTO_ORDER] [${magicNumber}] Sell order ${current.orderId} changed:`, {
                    statusFrom: OrderStatus[prev.orderStatus],
                    statusTo: OrderStatus[current.orderStatus],
                    filledFrom: prev.filledQuantity,
                    filledTo: current.filledQuantity,
                    remainingQty: current.quantity - current.filledQuantity
                });
            });
        }

        if (changedBuyOrders.length > 0) {
            changedBuyOrders.forEach(current => {
                const prev = previousBuyOrders.find(p => p.orderId === current.orderId)!;
                console.log(`[${timestamp}] [AUTO_ORDER] [${magicNumber}] Buy order ${current.orderId} changed:`, {
                    statusFrom: OrderStatus[prev.orderStatus],
                    statusTo: OrderStatus[current.orderStatus],
                    filledFrom: prev.filledQuantity,
                    filledTo: current.filledQuantity,
                    remainingQty: current.quantity - current.filledQuantity
                });
            });
        }

        // Log cumulative tracking info after updates
        console.log(`[${timestamp}] [AUTO_ORDER] [${magicNumber}] Current tracking state:`, {
            sellFilled: trackingData.sellFilledQuantity,
            buyFilled: trackingData.buyFilledQuantity,
            cumulativeSellFilled: trackingData.cumulativeSellFilledQuantity,
            cumulativeBuyFilled: trackingData.cumulativeBuyFilledQuantity,
            sellRemaining: trackingData.sellRemainingQuantity,
            buyRemaining: trackingData.buyRemainingQuantity,
            isExiting: trackingData.isExiting,
            waitingTime: trackingData.waitingTime > 0 ? Math.round((Date.now() - trackingData.waitingTime) / 1000) + 's' : '0s'
        });
    }

    // Calculate filled and remaining quantities for both sell and buy orders
    private calculateOrderQuantities(magicNumber: string): void {
        const trackingData = this.orderTrackingData.get(magicNumber)!;

        // Keep track of the previous values before reset
        const previousSellFilledQuantity = trackingData.sellFilledQuantity;
        const previousBuyFilledQuantity = trackingData.buyFilledQuantity;

        // Reset quantities for current open orders
        trackingData.sellFilledQuantity = 0;
        trackingData.buyFilledQuantity = 0;
        trackingData.sellRemainingQuantity = 0;
        trackingData.buyRemainingQuantity = 0;

        // Calculate for sell orders
        trackingData.sellOrders.forEach(order => {
            trackingData.sellFilledQuantity += order.filledQuantity;
            trackingData.sellRemainingQuantity += (order.quantity - order.filledQuantity);
        });

        // Calculate for buy orders
        trackingData.buyOrders.forEach(order => {
            trackingData.buyFilledQuantity += order.filledQuantity;
            trackingData.buyRemainingQuantity += (order.quantity - order.filledQuantity);
        });

        // Update cumulative filled quantities
        // This ensures we don't lose track of filled quantities from canceled orders
        if (trackingData.sellFilledQuantity > trackingData.cumulativeSellFilledQuantity) {
            trackingData.cumulativeSellFilledQuantity = trackingData.sellFilledQuantity;
        }

        if (trackingData.buyFilledQuantity > trackingData.cumulativeBuyFilledQuantity) {
            trackingData.cumulativeBuyFilledQuantity = trackingData.buyFilledQuantity;
        }

        // Log significant changes
        if (trackingData.sellFilledQuantity !== previousSellFilledQuantity ||
            trackingData.buyFilledQuantity !== previousBuyFilledQuantity) {
            console.log(`Order quantities updated for ${magicNumber}:`, {
                sellFilled: trackingData.sellFilledQuantity,
                buyFilled: trackingData.buyFilledQuantity,
                sellRemaining: trackingData.sellRemainingQuantity,
                buyRemaining: trackingData.buyRemainingQuantity,
                cumulativeSellFilled: trackingData.cumulativeSellFilledQuantity,
                cumulativeBuyFilled: trackingData.cumulativeBuyFilledQuantity
            });
        }
    }

    // Main logic for managing order status
    private async manageOrderStatus(magicNumber: string): Promise<void> {
        const trackingData = this.orderTrackingData.get(magicNumber);
        const arbitragePair = this.processingArbitragePairs.get(magicNumber); // Get the original pair config

        if (!trackingData || !arbitragePair) {
            this.logWithTimestamp(`[${magicNumber}] Tracking data or ArbitragePair not found in manageOrderStatus.`);
            this.removeFromProcessing(magicNumber);
            return;
        }

        const sellFilled = trackingData.cumulativeSellFilledQuantity;
        const buyFilled = trackingData.cumulativeBuyFilledQuantity;
        const actualExtraBuyQuantity = arbitragePair.extraBuyQuantity ?? 0;
        const tolerance = 0.00001; // Small tolerance for floating point comparisons

        // *** Add logging for the orders being checked ***
        this.logWithTimestamp(`[${magicNumber}] Checking orders for hasOpenOrders`, {
            sellOrders: trackingData.sellOrders.map(o => ({ id: o.orderId, status: OrderStatus[o.orderStatus], qty: o.quantity, filled: o.filledQuantity })),
            buyOrders: trackingData.buyOrders.map(o => ({ id: o.orderId, status: OrderStatus[o.orderStatus], qty: o.quantity, filled: o.filledQuantity }))
        });
        // *** End added logging ***

        // Check if balanced, considering the extraBuyQuantity
        const diff = Math.abs(buyFilled - sellFilled);
        const isApproximatelyBalanced = diff <= actualExtraBuyQuantity + tolerance;

        const hasOpenOrders = trackingData.sellOrders.some(o => ![OrderStatus.Filled, OrderStatus.Cancelled, OrderStatus.Rejected, OrderStatus.PartiallyCanceled].includes(o.orderStatus)) ||
            trackingData.buyOrders.some(o => ![OrderStatus.Filled, OrderStatus.Cancelled, OrderStatus.Rejected, OrderStatus.PartiallyCanceled].includes(o.orderStatus));

        // Consider complete if no open orders and approximately balanced
        const isComplete = !hasOpenOrders && isApproximatelyBalanced;
        const hasImbalance = !isApproximatelyBalanced; // Explicitly define imbalance based on the approx check

        const statusSummary = {
            sellFilled: sellFilled,
            buyFilled: buyFilled,
            hasImbalance: hasImbalance,
            hasOpenOrders: hasOpenOrders,
            isComplete: isComplete,
            isExiting: trackingData.isExiting,
            currentTime: Date.now(),
            lastCheckedTime: trackingData.lastCheckedTime,
            waitingTime: trackingData.waitingTime
        };

        this.logWithTimestamp(`[${magicNumber}] Managing order status`, statusSummary);


        // Condition 1: Trade is complete (no open orders, balanced considering extraBuyQuantity)
        console.log(`[DEBUG][${magicNumber}] Before isComplete check: isComplete=${isComplete}, hasOpenOrders=${hasOpenOrders}, isApproximatelyBalanced=${isApproximatelyBalanced}`);
        if (isComplete) {
            this.logWithTimestamp(`[${magicNumber}] Trade is complete and balanced (considering extraBuyQuantity=${actualExtraBuyQuantity}). Cleaning up.`);
            this.removeFromProcessing(magicNumber);
            return;
        }

        // Condition 2: No open orders, but there's a real imbalance (beyond extraBuyQuantity)
        if (hasImbalance && !hasOpenOrders) {
            this.logWithTimestamp(`[${magicNumber}] No open orders, but imbalance detected. Handling partial execution.`);
            // Use setTimeout to avoid potential race conditions if called immediately
            setTimeout(() => this.handlePartialExecution(magicNumber), 1000);
            return;
        }

        // Condition 3: Open orders exist
        if (hasOpenOrders) {
            const now = Date.now();
            const initialOrderTime = Math.min(
                ...(trackingData.sellOrders.map(o => o.orderTime)),
                ...(trackingData.buyOrders.map(o => o.orderTime))
            );
            const timeSinceCreation = (now - initialOrderTime) / 1000; // in seconds

            // Sub-condition 3a: Initial wait period (e.g., 5 seconds) - only if NOT in exit mode
            if (!trackingData.isExiting && trackingData.waitingTime > 0 && (now - trackingData.lastCheckedTime >= trackingData.waitingTime * 1000)) {
                // Check if any order has filled at all
                const anyFill = trackingData.cumulativeSellFilledQuantity > 0 || trackingData.cumulativeBuyFilledQuantity > 0;

                if (!anyFill) {
                    // If still no fills after the initial wait, cancel and enter exit mode aggressively
                    this.logWithTimestamp(`[${magicNumber}] Initial wait time elapsed (${trackingData.waitingTime}s) with NO fills. Cancelling and entering exit mode.`);
                    trackingData.isExiting = true; // Enter exit mode
                    await this.cancelAllOrders(magicNumber);
                    // handlePartialExecution will be called implicitly if cancel leads to imbalance, or next cycle will re-evaluate
                    return;
                } else if (sellFilled === 0 || buyFilled === 0 || hasImbalance) {
                    // If there are partial fills or an imbalance after the wait, cancel and handle
                    this.logWithTimestamp(`[${magicNumber}] Initial wait time elapsed (${trackingData.waitingTime}s) with partial fills or imbalance. Cancelling and entering exit mode.`);
                    trackingData.isExiting = true; // Enter exit mode
                    await this.cancelAllOrders(magicNumber);
                    // handlePartialExecution will be called implicitly if cancel leads to imbalance, or next cycle will re-evaluate
                    return;
                } else {
                    // If fully filled and balanced within the wait time (unlikely to hit this due to earlier isComplete check, but safe)
                    this.logWithTimestamp(`[${magicNumber}] Orders filled within initial wait time.`);
                    trackingData.waitingTime = 0; // Stop the initial wait timer check
                }

                // Sub-condition 3b: Exit mode timeout for retrying (e.g., 30 seconds since last adjustment/placement)
            } else if (trackingData.isExiting) {
                // Use a longer timeout in exit mode before aggressive cancellation/repricing
                const timeSinceLastAdjustment = (now - (trackingData.lastCheckedTime)) / 1000; // Time since last check/action in exit mode
                const exitRetryTimeout = 10; // seconds - Time to wait before retrying exit

                // *** Add logging for timeout check ***
                this.logWithTimestamp(`[${magicNumber}] DEBUG Exit Mode Timeout Check:`, {
                    now: now,
                    lastCheckedTime: trackingData.lastCheckedTime,
                    timeSinceLastAdjustment: timeSinceLastAdjustment.toFixed(1) + 's',
                    exitRetryTimeout: exitRetryTimeout + 's',
                    conditionMet: timeSinceLastAdjustment >= exitRetryTimeout
                });
                // *** End added logging ***

                if (timeSinceLastAdjustment >= exitRetryTimeout) {
                    this.logWithTimestamp(`[${magicNumber}] In exit mode, orders open for > ${exitRetryTimeout}s. Cancelling and retrying adjustment.`);
                    await this.cancelAllOrders(magicNumber);
                    // Let handlePartialExecution logic take over after cancellation
                    return;
                } else {
                    this.logWithTimestamp(`[${magicNumber}] In exit mode, open orders exist but haven't reached retry timeout (${exitRetryTimeout}s). Waiting.`);
                }

                // Sub-condition 3c: Standard check - open orders exist, but no specific timer has elapsed yet
            } else {
                // This case might occur if initial wait timer was 0 or already passed, and not yet in exit mode.
                // Simply log that orders are open but no action is taken this cycle based on timers.
                this.logWithTimestamp(`[${magicNumber}] Open orders exist. No timeout reached for action this cycle.`);

                // Fallback safety: If orders are stuck NEW for a very long time (e.g., 5 mins) without entering exit mode, force cancellation.
                const veryLongTimeout = 300; // seconds (5 minutes)
                if (timeSinceCreation > veryLongTimeout && trackingData.sellFilledQuantity === 0 && trackingData.buyFilledQuantity === 0) {
                    this.logWithTimestamp(`[${magicNumber}] Orders stuck in NEW state for > ${veryLongTimeout}s. Forcing cancellation and exit.`);
                    trackingData.isExiting = true;
                    await this.cancelAllOrders(magicNumber);
                    return;
                }
            }
        }

        // Update last checked time if the loop continues
        trackingData.lastCheckedTime = Date.now();
        this.orderTrackingData.set(magicNumber, trackingData);
    }

    // Cancel all orders for a specific arbitrage pair
    private async cancelAllOrders(magicNumber: string): Promise<void> {
        const trackingData = this.orderTrackingData.get(magicNumber)!;
        const timestamp = new Date().toISOString();

        this.logWithTimestamp(`[AUTO_ORDER] [${magicNumber}] ORDER CANCELLATION INITIATED by auto-order service`, {
            sellOrders: trackingData.sellOrders.length,
            buyOrders: trackingData.buyOrders.length,
            sellFilled: trackingData.sellFilledQuantity,
            buyFilled: trackingData.buyFilledQuantity,
            cumulativeSellFilled: trackingData.cumulativeSellFilledQuantity,
            cumulativeBuyFilled: trackingData.cumulativeBuyFilledQuantity
        });

        // Save information about partially filled orders before canceling
        for (const order of trackingData.sellOrders) {
            if (order.orderStatus !== OrderStatus.Filled &&
                order.orderStatus !== OrderStatus.Cancelled &&
                order.orderStatus !== OrderStatus.Rejected &&
                order.filledQuantity > 0) {

                trackingData.lastCanceledSellOrder = { ...order };
                this.logWithTimestamp(`[AUTO_ORDER] [${magicNumber}] Saving partially filled sell order before cancellation`, {
                    orderId: order.orderId,
                    status: OrderStatus[order.orderStatus],
                    quantity: order.quantity,
                    filled: order.filledQuantity,
                    symbol: order.symbol.token
                });

                // Update cumulative filled quantity
                if (order.filledQuantity > 0 &&
                    (trackingData.cumulativeSellFilledQuantity < trackingData.sellFilledQuantity)) {
                    trackingData.cumulativeSellFilledQuantity = trackingData.sellFilledQuantity;
                    this.logWithTimestamp(`[AUTO_ORDER] [${magicNumber}] Updated cumulative sell filled quantity to ${trackingData.cumulativeSellFilledQuantity}`);
                }
            }

            if (order.orderStatus !== OrderStatus.Filled &&
                order.orderStatus !== OrderStatus.Cancelled &&
                order.orderStatus !== OrderStatus.Rejected) {
                this.logWithTimestamp(`[AUTO_ORDER] [${magicNumber}] Cancelling sell order`, {
                    orderId: order.orderId,
                    status: OrderStatus[order.orderStatus],
                    filled: order.filledQuantity,
                    remaining: order.quantity - order.filledQuantity
                });
                await this.orderService.cancelOrder(order);
            }
        }

        // Save information about partially filled orders before canceling
        for (const order of trackingData.buyOrders) {
            if (order.orderStatus !== OrderStatus.Filled &&
                order.orderStatus !== OrderStatus.Cancelled &&
                order.orderStatus !== OrderStatus.Rejected &&
                order.filledQuantity > 0) {

                trackingData.lastCanceledBuyOrder = { ...order };
                this.logWithTimestamp(`[AUTO_ORDER] [${magicNumber}] Saving partially filled buy order before cancellation`, {
                    orderId: order.orderId,
                    status: OrderStatus[order.orderStatus],
                    quantity: order.quantity,
                    filled: order.filledQuantity,
                    symbol: order.symbol.token
                });

                // Update cumulative filled quantity
                if (order.filledQuantity > 0 &&
                    (trackingData.cumulativeBuyFilledQuantity < trackingData.buyFilledQuantity)) {
                    trackingData.cumulativeBuyFilledQuantity = trackingData.buyFilledQuantity;
                    this.logWithTimestamp(`[AUTO_ORDER] [${magicNumber}] Updated cumulative buy filled quantity to ${trackingData.cumulativeBuyFilledQuantity}`);
                }
            }

            if (order.orderStatus !== OrderStatus.Filled &&
                order.orderStatus !== OrderStatus.Cancelled &&
                order.orderStatus !== OrderStatus.Rejected) {
                this.logWithTimestamp(`[AUTO_ORDER] [${magicNumber}] Cancelling buy order`, {
                    orderId: order.orderId,
                    status: OrderStatus[order.orderStatus],
                    filled: order.filledQuantity,
                    remaining: order.quantity - order.filledQuantity
                });
                await this.orderService.cancelOrder(order);
            }
        }

        // Log cancellation summary
        this.logWithTimestamp(`[AUTO_ORDER] [${magicNumber}] ORDER CANCELLATION COMPLETED`, {
            sellFilled: trackingData.sellFilledQuantity,
            buyFilled: trackingData.buyFilledQuantity,
            cumulativeSellFilled: trackingData.cumulativeSellFilledQuantity,
            cumulativeBuyFilled: trackingData.cumulativeBuyFilledQuantity,
            hasLastCanceledSellOrder: !!trackingData.lastCanceledSellOrder,
            hasLastCanceledBuyOrder: !!trackingData.lastCanceledBuyOrder
        });
    }

    // Handle partial execution of orders
    private async handlePartialExecution(magicNumber: string): Promise<void> {
        const trackingData = this.orderTrackingData.get(magicNumber);
        const arbitragePair = this.processingArbitragePairs.get(magicNumber); // Get the original pair config

        if (!trackingData || !arbitragePair) {
            this.logWithTimestamp(`[${magicNumber}] Tracking data or ArbitragePair not found in handlePartialExecution.`);
            this.removeFromProcessing(magicNumber);
            return;
        }

        // Ensure we are in exit mode when handling partials post-cancellation
        trackingData.isExiting = true;

        const sellFilled = trackingData.cumulativeSellFilledQuantity;
        const buyFilled = trackingData.cumulativeBuyFilledQuantity;
        const diff = buyFilled - sellFilled; // Positive diff means buy > sell (need to sell more), Negative diff means sell > buy (need to buy more)
        const absDiff = Math.abs(diff);
        const actualExtraBuyQuantity = arbitragePair.extraBuyQuantity ?? 0;
        const tolerance = 0.00001; // Small tolerance for floating point comparisons

        this.logWithTimestamp(`[${magicNumber}] Handling partial execution - DETAILED STATE`, {
            sellFilled: sellFilled,
            buyFilled: buyFilled,
            cumulativeSellFilled: trackingData.cumulativeSellFilledQuantity,
            cumulativeBuyFilled: trackingData.cumulativeBuyFilledQuantity,
            sellRemaining: trackingData.sellRemainingQuantity,
            buyRemaining: trackingData.buyRemainingQuantity,
            diff: diff,
            targetExtraBuyQuantity: actualExtraBuyQuantity,
            isExiting: trackingData.isExiting,
            retryCount: trackingData.retryCount,
            lastAdjustedPrice: trackingData.lastAdjustedPrice,
            priceAdjustmentPercent: trackingData.priceAdjustmentPercent,
        });

        // Check if the imbalance is acceptable given the extraBuyQuantity
        if (absDiff <= actualExtraBuyQuantity + tolerance) {
            this.logWithTimestamp(`[${magicNumber}] Imbalance (${diff.toFixed(8)}) is within the acceptable extraBuyQuantity (${actualExtraBuyQuantity}). Considering trade complete.`);
            this.removeFromProcessing(magicNumber); // Mark as complete
            return; // Stop processing, no corrective order needed
        }


        // Determine which side needs a matching order
        if (diff > 0) { // Buy side is greater, need to place a sell order
            const quantityToSell = diff; // Sell the difference
            this.logWithTimestamp(`[${magicNumber}] Need to place sell order to match buy side`, { quantityToSell });
            if (quantityToSell > 0) {
                await this.placeMatchingOrderWithRetries(magicNumber, 'sell', quantityToSell);
            } else {
                this.logWithTimestamp(`[${magicNumber}] Calculated sell quantity is zero or negative. No sell order placed.`);
                // If diff is positive but quantityToSell is not, something is wrong, but check balance again.
                if (Math.abs(buyFilled - sellFilled) <= actualExtraBuyQuantity + tolerance) {
                    this.removeFromProcessing(magicNumber);
                }
            }
        } else if (diff < 0) { // Sell side is greater, need to place a buy order
            const quantityToBuy = absDiff; // Buy the difference
            this.logWithTimestamp(`[${magicNumber}] Need to place buy order to match sell side`, { quantityToBuy });
            if (quantityToBuy > 0) {
                await this.placeMatchingOrderWithRetries(magicNumber, 'buy', quantityToBuy);
            } else {
                this.logWithTimestamp(`[${magicNumber}] Calculated buy quantity is zero or negative. No buy order placed.`);
                // If diff is negative but quantityToBuy is not, something is wrong, but check balance again.
                if (Math.abs(buyFilled - sellFilled) <= actualExtraBuyQuantity + tolerance) {
                    this.removeFromProcessing(magicNumber);
                }
            }
        } else {
            // This case should theoretically not be reached if the earlier check passed,
            // but included for completeness. It means diff is 0.
            this.logWithTimestamp(`[${magicNumber}] Filled quantities are exactly equal. No partial execution needed.`);
            this.removeFromProcessing(magicNumber); // Already balanced
        }
    }

    // Place a matching order with price adjustments for volatility management
    private async placeMatchingOrderWithRetries(
        magicNumber: string,
        side: 'buy' | 'sell',
        quantity: number
    ): Promise<void> {
        const trackingData = this.orderTrackingData.get(magicNumber)!;
        const arbitragePair = this.processingArbitragePairs.get(magicNumber)!;
        const maxRetries = 3;
        let retryAttempt = 0;
        const actualSide = side; // Store the original side for logging

        this.logWithTimestamp(`[AUTO_ORDER] [${magicNumber}] Starting matching order attempt for ${actualSide} order of ${quantity} units`);

        // *** Log retry count before increment ***
        this.logWithTimestamp(`[AUTO_ORDER] [${magicNumber}] DEBUG Retry Count Before Increment: ${trackingData.retryCount}`);
        // *** End added logging ***

        // Use more aggressive adjustment if we already had a partially filled order
        const hasPartialFill = side === 'buy' ?
            trackingData.cumulativeBuyFilledQuantity > 0 :
            trackingData.cumulativeSellFilledQuantity > 0;

        // More aggressive adjustment for orders with partial fills (0.2% instead of 0.1%)
        const adjustmentStep = hasPartialFill ? 0.2 : 0.1;
        trackingData.priceAdjustmentPercent -= adjustmentStep;

        this.logWithTimestamp(`[AUTO_ORDER] [${magicNumber}] Retry attempt, adjusting price by ${adjustmentStep}% (${hasPartialFill ? 'aggressive' : 'normal'} adjustment)`);

        // Calculate the current adjusted profit
        const adjustedProfit = trackingData.initialProfitPercent + trackingData.priceAdjustmentPercent;

        // If we've reached the maximum loss threshold (-0.2%), place one final order at that level
        if (adjustedProfit < -0.2) {
            this.logWithTimestamp(`[${magicNumber}] Reached maximum loss threshold. Placing final order at -0.2% loss`, {
                initialProfit: trackingData.initialProfitPercent.toFixed(2) + '%',
                currentAdjustment: trackingData.priceAdjustmentPercent.toFixed(2) + '%',
                adjustedProfit: adjustedProfit.toFixed(2) + '%',
                finalAdjustment: (-0.2 - trackingData.initialProfitPercent).toFixed(2) + '%'
            });

            // Set the adjustment to achieve exactly -0.2% total loss
            trackingData.priceAdjustmentPercent = -0.2 - trackingData.initialProfitPercent;
        }

        trackingData.retryCount++;
        // *** Log retry count after increment ***
        this.logWithTimestamp(`[AUTO_ORDER] [${magicNumber}] DEBUG Retry Count After Increment: ${trackingData.retryCount}`);
        // *** End added logging ***

        while (retryAttempt < maxRetries) {
            try {
                let orderSymbol: ISymbol;
                let basePrice: number;
                let availableQuantityOrBatches: number;
                let rawOrderQuantity: number;
                let isValueCheckNeeded = false;
                let minValue = 0;

                // Determine symbol, base price, quantity checks based on side
                if (actualSide === 'buy') {
                    orderSymbol = arbitragePair.buyMarketDataContainer.symbol;
                    availableQuantityOrBatches = this.arbitrageService.getAvailableBatches(arbitragePair);
                    if (availableQuantityOrBatches === 0) {
                        console.error(`[${magicNumber}] No available balance (USDT batches) to place matching buy order`);
                        return; // Exit if no balance
                    }
                    basePrice = arbitragePair.buyMarketDataContainer.marketDepths.getBestBuyPrice()?.price ?? 0;
                    rawOrderQuantity = Math.min(quantity, availableQuantityOrBatches * arbitragePair.sellQuantity);
                    minValue = orderSymbol.tradeInterface === TradeInterface.MEXCApi ? 1 : (orderSymbol.tradeInterface === TradeInterface.BiTrueApi ? 10 : 0);
                    isValueCheckNeeded = minValue > 0;

                } else { // side === 'sell'
                    orderSymbol = arbitragePair.sellMarketDataContainer.symbol;
                    const symbolInfo = orderSymbol as SymbolCrypto;
                    const baseCurrencyString = symbolInfo.baseSymbol;
                    const baseCryptoCoin = this.symbolManagerService.getCryptoCoin(
                        symbolInfo.tradeInterface, symbolInfo.segment, baseCurrencyString
                    );
                    if (!baseCryptoCoin) {
                        console.error(`[${magicNumber}] Could not find CryptoCoin object for base currency: ${baseCurrencyString}`);
                        return;
                    }
                    const balance = this.orderService.getBalance(baseCryptoCoin);
                    availableQuantityOrBatches = balance?.free ?? 0;
                    if (availableQuantityOrBatches < quantity) {
                        console.error(`[${magicNumber}] Insufficient balance (${availableQuantityOrBatches} ${baseCurrencyString}) to place matching sell order for ${quantity} units`);
                        return; // Exit if insufficient balance
                    }
                    basePrice = arbitragePair.sellMarketDataContainer.marketDepths.getBestSellPrice()?.price ?? 0;
                    rawOrderQuantity = quantity; // For sell, the needed quantity is directly used
                    minValue = orderSymbol.tradeInterface === TradeInterface.MEXCApi ? 1 : (orderSymbol.tradeInterface === TradeInterface.BiTrueApi ? 10 : 0);
                    isValueCheckNeeded = minValue > 0;
                }

                // Use last adjusted price if current market price is unavailable
                if (basePrice === 0 && trackingData.lastAdjustedPrice > 0) {
                    basePrice = trackingData.lastAdjustedPrice;
                    this.logWithTimestamp(`[AUTO_ORDER] [${magicNumber}] Using last adjusted price ${basePrice.toFixed(6)} as base price (market price unavailable)`);
                }

                // Apply price adjustment
                const adjustmentFactor = 1 + (trackingData.priceAdjustmentPercent / 100);
                let adjustedPrice = basePrice * adjustmentFactor;
                trackingData.lastAdjustedPrice = adjustedPrice; // Store the latest price used

                // Normalize price and quantity
                const normalizedPrice = this.normalizePrice(orderSymbol, adjustedPrice);
                const normalizedQuantity = this.normalizeQuantity(orderSymbol, rawOrderQuantity);

                // Check minimum order value if applicable
                if (isValueCheckNeeded) {
                    const orderValue = normalizedPrice * normalizedQuantity;
                    if (orderValue < minValue) {
                        console.warn(`[${magicNumber}] ${TradeInterface[orderSymbol.tradeInterface]} ${actualSide} order value (${orderValue.toFixed(2)} USDT) is below minimum threshold of ${minValue} USDT. Skipping order.`);
                        return; // Exit if below threshold
                    }
                }

                // Generate a unique client order ID for this retry attempt
                const retryClientOrderId = `${magicNumber}-retry-${trackingData.retryCount}`;

                this.logWithTimestamp(
                    `[AUTO_ORDER] [${magicNumber}] Placing adjusted ${actualSide} order (attempt ${trackingData.retryCount}/${maxRetries})`,
                    {
                        exchange: TradeInterface[orderSymbol.tradeInterface],
                        symbol: orderSymbol.token,
                        basePrice: basePrice.toFixed(6),
                        adjustedPrice: adjustedPrice.toFixed(6), // Log the un-normalized price for comparison
                        normalizedPrice: normalizedPrice.toFixed(orderSymbol.decimalPlace),
                        adjustment: trackingData.priceAdjustmentPercent.toFixed(2) + '%',
                        rawQuantity: rawOrderQuantity,
                        normalizedQuantity: normalizedQuantity,
                        orderValue: (normalizedPrice * normalizedQuantity).toFixed(2) + ' USDT',
                        retryClientOrderId: retryClientOrderId // Log the unique ID used
                    }
                );

                // Place the order
                await this.orderService.placeOrder(
                    orderSymbol,
                    actualSide === 'buy' ? TransactionType.Buy : TransactionType.Sell,
                    OrderType.Limit,
                    normalizedPrice,
                    normalizedQuantity,
                    retryClientOrderId, // Use the unique ID
                    arbitragePair.placeOrderViaWeb
                );

                this.logWithTimestamp(`[AUTO_ORDER] [${magicNumber}] ${actualSide} order placement successful (Attempt ${trackingData.retryCount})`);
                return; // Exit loop on successful order placement

            } catch (error) {
                retryAttempt++;
                const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
                this.logWithTimestamp(`[AUTO_ORDER] [${magicNumber}] Error placing ${actualSide} order (attempt ${retryAttempt}/${maxRetries}): ${errorMessage}`);

                if (retryAttempt >= maxRetries) {
                    console.error(`[${magicNumber}] Failed to place ${actualSide} order after ${maxRetries} attempts.`);
                    // Optionally: Implement a final fallback strategy here, e.g., market order, or log critical failure
                    return; // Exit after max retries
                }

                // Wait briefly before retrying
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    // Remove an arbitrage pair from processing
    private removeFromProcessing(magicNumber: string): void {
        const timestamp = new Date().toISOString();

        // Clean up timers
        if (this.orderManagementTimers.has(magicNumber)) {
            clearTimeout(this.orderManagementTimers.get(magicNumber));
            this.orderManagementTimers.delete(magicNumber);
        }

        // Remove from tracking
        this.orderTrackingData.delete(magicNumber);

        // Remove from processing
        this.processingArbitragePairs.delete(magicNumber);

        // Persist changes
        this.persistProcessingArbitragePairs();

        // Emit event for UI updates
        this.autoOrderEvents.emit({
            MessageType: MessageTypes.ARBITRAGE_AUTO_ORDER_CLEARED,
            Data: null
        });

        this.logWithTimestamp(`[AUTO_ORDER] [${magicNumber}] Arbitrage pair has been fully processed and removed from tracking`);
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