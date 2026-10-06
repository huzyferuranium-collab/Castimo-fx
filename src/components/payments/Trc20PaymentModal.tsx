import React from 'react';
import { ProfitSharePaymentModal } from './ProfitSharePaymentModal';

interface Trc20PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
}

export const Trc20PaymentModal: React.FC<Trc20PaymentModalProps> = (props) => {
  return <ProfitSharePaymentModal {...props} />;
};
