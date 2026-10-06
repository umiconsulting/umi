import { ReactNode } from 'react';
import { cn } from '@/utils';

interface ButtonProps {
  children: ReactNode;
  variant?: 'primary' | 'secondary';
  className?: string;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
}

export const Button = ({
  children,
  variant = 'primary',
  className,
  onClick,
  type = 'button',
  disabled = false,
}: ButtonProps) => {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 font-extrabold transition-all',
        variant === 'primary'
          ? 'bg-umi-blue-dark text-white shadow-[0_14px_36px_rgba(34,57,121,0.22)] hover:bg-umi-blue-80'
          : 'border border-umi-blue-dark bg-transparent text-umi-blue-dark hover:bg-umi-blue-dark hover:text-white',
        disabled && 'opacity-50 cursor-not-allowed hover:bg-current',
        className,
      )}
    >
      {children}
    </button>
  );
};
