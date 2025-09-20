export const MetricServiceClient = jest.fn().mockImplementation(() => ({
  createTimeSeries: jest.fn().mockResolvedValue(undefined),
}));

export const AlertPolicyServiceClient = jest.fn().mockImplementation(() => ({
  createAlertPolicy: jest.fn().mockResolvedValue(undefined),
}));
