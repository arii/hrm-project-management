import React from 'react';
import { Key, Plus } from 'lucide-react';
import Button from './Button';
import { useNavigate } from 'react-router-dom';

interface CredentialsRequiredProps {
  title?: string;
  message?: string;
  onAction?: () => void;
  actionLabel?: string;
}

const CredentialsRequired: React.FC<CredentialsRequiredProps> = ({ 
  title = "Credentials Required", 
  message = "Configure your repository name and GitHub personal access token in Settings to access this feature.",
  onAction,
  actionLabel = "Go to Settings"
}) => {
  const navigate = useNavigate();
  
  const handleAction = () => {
    if (onAction) {
      onAction();
    } else {
      navigate('/');
    }
  };

  return (
    <div className="bg-surface border border-amber-800/30 rounded-2xl p-12 text-center space-y-6 animate-in fade-in zoom-in-95">
      <div className="w-20 h-20 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto">
        <Key className="w-10 h-10 text-amber-500" />
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-white">{title}</h2>
        <p className="text-slate-400 max-w-md mx-auto">
          {message}
        </p>
      </div>
      <Button variant="primary" onClick={handleAction} icon={Plus}>
        {actionLabel}
      </Button>
    </div>
  );
};

export default CredentialsRequired;
