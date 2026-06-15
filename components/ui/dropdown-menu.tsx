import React, { useState, useRef, useEffect } from 'react';
import { useIsMobile } from '../../hooks/useMediaQuery';

interface DropdownMenuItem {
  label: string;
  value: string;
  onClick?: () => void;
}

interface DropdownMenuProps {
  trigger: React.ReactNode;
  items: DropdownMenuItem[];
  align?: 'start' | 'end';
  disabled?: boolean;
  className?: string;
  isDataSelection?: boolean;
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
}

export function DropdownMenu({ 
  trigger, 
  items, 
  align = 'start', 
  disabled = false, 
  className = '',
  isDataSelection = false,
  value,
  onChange,
  placeholder = 'Select option...'
}: DropdownMenuProps) {
  const isMobile = useIsMobile();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Mobile data selection: render native select
  if (isMobile && isDataSelection && onChange) {
    return (
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={`min-h-[44px] min-w-[44px] w-full px-3 py-2 border border-[--border] rounded-md bg-[--card] text-[--fg] ${className}`}
      >
        <option value="">{placeholder}</option>
        {items.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    );
  }

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        triggerRef.current && !triggerRef.current.contains(event.target as Node) &&
        contentRef.current && !contentRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className={`relative ${className}`}>
      <div
        ref={triggerRef}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      >
        {trigger}
      </div>

      {isOpen && (
        <div
          ref={contentRef}
          className={`absolute top-full mt-1 bg-[--card] border border-[--border] rounded-md shadow-lg min-w-[200px] py-1 ${
            align === 'end' ? 'right-0' : 'left-0'
          } ${
            // FLOWSEER-DROP-001: z-index capped at 39 on mobile to prevent sidebar (z-50) collision
            isMobile ? 'z-[39]' : 'z-50'
          }`}
        >
          {items.map((item) => (
            <button
              key={item.value}
              onClick={() => {
                if (isDataSelection && onChange) {
                  onChange(item.value);
                } else if (item.onClick) {
                  item.onClick();
                }
                setIsOpen(false);
              }}
              className={`w-full px-3 py-2 text-left hover:bg-[--muted] focus:bg-[--muted] focus:outline-none text-[--fg] ${
                isMobile ? 'min-h-[44px]' : ''
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Convenience components for common patterns
export const DropdownMenuTrigger = ({ children, ...props }: { children: React.ReactNode; [key: string]: any }) => (
  <div {...props}>{children}</div>
);

export const DropdownMenuContent = ({ children, className = '', ...props }: { 
  children: React.ReactNode; 
  className?: string;
  [key: string]: any;
}) => {
  const isMobile = useIsMobile();
  return (
    <div 
      className={`bg-[--card] border border-[--border] rounded-md shadow-lg py-1 ${
        // FLOWSEER-DROP-001: z-index capped at 39 on mobile to prevent sidebar (z-50) collision
        isMobile ? 'z-[39]' : 'z-50'
      } ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};

export const DropdownMenuItem = ({ children, onClick, className = '', ...props }: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  [key: string]: any;
}) => {
  const isMobile = useIsMobile();
  return (
    <button
      onClick={onClick}
      className={`w-full px-3 py-2 text-left hover:bg-[--muted] focus:bg-[--muted] focus:outline-none text-[--fg] ${
        isMobile ? 'min-h-[44px]' : ''
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};
