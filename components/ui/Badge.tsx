
import React from 'react';
import clsx from 'clsx';
import { LucideIcon } from 'lucide-react';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'blue' | 'green' | 'red' | 'yellow' | 'purple' | 'gray' | 'slate';
  icon?: LucideIcon;
  className?: string;
  title?: string;
}

const Badge: React.FC<BadgeProps> = ({ children, variant = 'slate', icon: Icon, className, title }) => {
  const styles = {
    blue: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    green: "bg-green-500/10 text-green-400 border-green-500/20",
    red: "bg-red-500/10 text-red-400 border-red-500/20",
    yellow: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    purple: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    gray: "bg-slate-700/50 text-slate-300 border-slate-600",
    slate: "bg-slate-800 text-slate-400 border-slate-700",
  };

  return (
    <span 
      title={title}
      className={clsx(
        "flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase border tracking-wide whitespace-nowrap",
        styles[variant],
        className
      )}
    >
      {Icon && <Icon className="w-3 h-3" />}
      {children}
    </span>
  );
};

export default Badge;
