
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface ErrorInfo {
  id: string;
  message: string;
  stack?: string;
  timestamp: number;
}

interface ErrorContextType {
  errors: ErrorInfo[];
  addError: (message: string, stack?: string) => void;
  removeError: (id: string) => void;
  clearErrors: () => void;
}

const ErrorContext = createContext<ErrorContextType | undefined>(undefined);

export const ErrorProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [errors, setErrors] = useState<ErrorInfo[]>([]);

  const addError = (message: string, stack?: string) => {
    // Filter out expected environment errors that are benign but noisy
    if (
      message.includes('[vite]') || 
      message.includes('WebSocket connection to') || 
      message.includes('WebSocket closed without opened') ||
      message.includes('failed to connect to websocket')
    ) {
      return;
    }

    const id = Math.random().toString(36).substr(2, 9);
    setErrors(prev => [...prev, { id, message, stack, timestamp: Date.now() }]);
  };

  const removeError = (id: string) => {
    setErrors(prev => prev.filter(e => e.id !== id));
  };

  const clearErrors = () => {
    setErrors([]);
  };

  useEffect(() => {
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;

    console.error = (...args: any[]) => {
      const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
      ).join(' ');
      
      // Capture stack trace if available
      const stack = new Error().stack;
      
      addError(message, stack);
      originalConsoleError.apply(console, args);
    };

    // We might want to capture warnings too if they look like errors
    console.warn = (...args: any[]) => {
      const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
      ).join(' ');
      
      if (message.toLowerCase().includes('error') || message.toLowerCase().includes('failed')) {
        addError(message);
      }
      originalConsoleWarn.apply(console, args);
    };

    window.onerror = (message, source, lineno, colno, error) => {
      addError(String(message), error?.stack);
    };

    window.onunhandledrejection = (event) => {
      addError(`Unhandled Promise Rejection: ${event.reason}`);
    };

    return () => {
      console.error = originalConsoleError;
      console.warn = originalConsoleWarn;
    };
  }, []);

  return (
    <ErrorContext.Provider value={{ errors, addError, removeError, clearErrors }}>
      {children}
    </ErrorContext.Provider>
  );
};

export const useErrors = () => {
  const context = useContext(ErrorContext);
  if (!context) {
    throw new Error('useErrors must be used within an ErrorProvider');
  }
  return context;
};
