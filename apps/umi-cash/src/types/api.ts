export interface CardState {
  cardId: string;
  cardNumber: string;
  customerName: string;
  tenantName: string;
  balanceCentavos: number;
  balanceMXN: string;
  totalVisits: number;
  visitsThisCycle: number;
  visitsRequired: number;
  pendingRewards: number;
  rewardName: string;
  rewardDescription: string | null;
  progressPercent: number;
  recentVisits: {
    id: string;
    scannedAt: string;
  }[];
  recentTransactions: {
    id: string;
    type: string;
    amountCentavos: number;
    description: string | null;
    createdAt: string;
  }[];
}

export interface ScanResult {
  success: boolean;
  action: 'VISIT' | 'REDEEM';
  message: string;
  customer: {
    name: string | null;
    cardNumber: string;
  };
  card: {
    visitsThisCycle: number;
    visitsRequired: number;
    pendingRewards: number;
    balanceMXN: string;
  };
  rewardEarned?: boolean;
}

export interface AdminCustomer {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  device: string | null;
  os: string | null;
  cardNumber: string;
  cardId: string;
  balanceMXN: string;
  balanceCentavos: number;
  totalVisits: number;
  visitsThisCycle: number;
  pendingRewards: number;
  lastVisit: string | null;
  createdAt: string;
  ltvCentavos: number;
  ltvMXN: string;
}

export interface RewardConfig {
  id: string;
  visitsRequired: number;
  rewardName: string;
  rewardDescription: string | null;
  rewardCostCentavos: number;
  isActive: boolean;
  activatedAt: string;
}

export interface TopUpResult {
  newBalanceCentavos: number;
  newBalanceMXN: string;
  amountMXN: string;
}

export interface ApiError {
  error: string;
}
