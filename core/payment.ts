export interface PaymentGateway {
  pay(idempotencyKey: string, amountMicro: bigint): Promise<{ charged: boolean }>;
}

export class CountingGateway implements PaymentGateway {
  attempts = 0;
  chargedMicro = 0n;
  private charged = new Map<string, bigint>();

  async pay(idempotencyKey: string, amountMicro: bigint): Promise<{ charged: boolean }> {
    this.attempts += 1;
    if (this.charged.has(idempotencyKey)) return { charged: false };
    this.charged.set(idempotencyKey, amountMicro);
    this.chargedMicro += amountMicro;
    return { charged: true };
  }

  get sent(): number {
    return this.charged.size;
  }
}
