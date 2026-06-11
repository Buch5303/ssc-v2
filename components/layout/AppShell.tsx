'use client';

import { ReactNode, useState, useRef } from 'react';
import { TopBar } from './TopBar';
import { SidebarDrawer } from './SidebarDrawer';
import { useMobileSwipe } from '../../hooks/useMobileSwipe';
import BottomNav from '../navigation/BottomNav';

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const mainContentRef = useRef<HTMLDivElement>(null);

  useMobileSwipe(mainContentRef, {
    onSwipeRight: () => setSidebarOpen(true)
  });

  const handleMenuClick = () => {
    setSidebarOpen(true);
  };

  return (
    <div className="min-h-screen bg-bg text-fg">
      {/* Sidebar Drawer */}
      <SidebarDrawer 
        open={sidebarOpen} 
        onClose={() => setSidebarOpen(false)} 
      />
      
      {/* Main Content */}
      <div className="flex flex-col min-h-screen">
        <TopBar onMenuClick={handleMenuClick} />
        
        <main 
          ref={mainContentRef}
          className="flex-1 p-4 pb-[calc(56px+env(safe-area-inset-bottom))] md:pb-4"
        >
          {children}
        </main>
      </div>
      
      {/* Bottom Navigation */}
      <BottomNav />
    </div>
  );
}