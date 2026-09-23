import type {
  BrokerExchangeArgs,
  BrokerExchangeMessage,
  CallBrokerMethodArgs,
  HelperHealth,
  ProbeHelperHealthOptions,
} from "./broker.d.ts";

export declare function brokerExchange(args: BrokerExchangeArgs): Promise<BrokerExchangeMessage>;

export declare function callBrokerMethod<T = unknown>(args: CallBrokerMethodArgs): Promise<T>;
export declare function probeHelperHealth(
  socketPath: string,
  options?: ProbeHelperHealthOptions,
): Promise<HelperHealth>;
