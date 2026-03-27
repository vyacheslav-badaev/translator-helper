/**
 * PopupHeader — Gradient header with app title, ACTIVE/OFF badge, and tab bar.
 * Renders at the top of the popup window.
 */

interface PopupHeaderProps {
  isActive: boolean;
  activeTab: 'settings' | 'history';
  onTabChange: (tab: 'settings' | 'history') => void;
}

export function PopupHeader({
  isActive,
  activeTab,
  onTabChange
}: PopupHeaderProps) {
  return (
    <div className="flex flex-col bg-linear-to-r from-blue-600 to-indigo-700 shadow shrink-0">
      <div className="flex items-center justify-between px-4 py-3 pb-2">
        <h1 className="text-lg font-bold text-white tracking-wide">
          Real-Time Translator
        </h1>
        <span
          className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
            isActive
              ? 'bg-green-400/20 text-green-200'
              : 'bg-white/10 text-white/60'
          }`}
        >
          {isActive ? 'ACTIVE' : 'OFF'}
        </span>
      </div>
      <div className="flex px-2 text-sm">
        <button
          onClick={() => onTabChange('settings')}
          className={`flex-1 py-1.5 font-medium border-b-2 transition-colors ${
            activeTab === 'settings'
              ? 'border-white text-white'
              : 'border-transparent text-white/60 hover:text-white/80'
          }`}
        >
          Settings
        </button>
        <button
          onClick={() => onTabChange('history')}
          className={`flex-1 py-1.5 font-medium border-b-2 transition-colors ${
            activeTab === 'history'
              ? 'border-white text-white'
              : 'border-transparent text-white/60 hover:text-white/80'
          }`}
        >
          History
        </button>
      </div>
    </div>
  );
}
