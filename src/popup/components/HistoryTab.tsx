/**
 * HistoryTab — Lists previously saved translation sessions.
 *
 * Each session card shows title, date, segment count, and action buttons:
 * Export (TXT download), Resume (restart with saved segments), Delete.
 */

import type { SessionData } from '../../storage/db';

interface HistoryTabProps {
  sessions: SessionData[];
  onExport: (session: SessionData) => void;
  onResume: (session: SessionData) => void;
  onDelete: (id: string) => void;
}

export function HistoryTab({
  sessions,
  onExport,
  onResume,
  onDelete
}: HistoryTabProps) {
  return (
    <div className="flex-1 flex flex-col space-y-3">
      <h2 className="text-sm font-semibold text-gray-700">Past Sessions</h2>
      {sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-32 text-gray-400 text-xs text-center border-2 border-dashed border-gray-200 rounded-lg">
          <p>No history yet.</p>
          <p className="mt-1 opacity-70">Completed sessions appear here.</p>
        </div>
      ) : (
        <div className="space-y-2 pb-2">
          {sessions.map((s) => (
            <div
              key={s.id}
              className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm"
            >
              <div className="flex justify-between items-start mb-1">
                <h3
                  className="font-semibold text-sm text-gray-800 line-clamp-1 flex-1 mr-2"
                  title={s.title}
                >
                  {s.title}
                </h3>
                <span className="text-[10px] text-gray-400 whitespace-nowrap pt-0.5">
                  {new Date(s.timestamp).toLocaleDateString()}
                </span>
              </div>
              <div className="flex justify-between items-center mt-3 border-t border-gray-50 pt-2">
                <span className="text-[10px] font-medium text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                  {s.segments.length} segments
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => onExport(s)}
                    className="text-[10px] font-medium text-blue-600 hover:text-blue-800 bg-blue-50 py-1 px-2 rounded cursor-pointer transition-colors"
                  >
                    Export
                  </button>
                  <button
                    onClick={() => onResume(s)}
                    className="text-[10px] font-medium text-green-600 hover:text-green-800 bg-green-50 py-1 px-2 rounded cursor-pointer transition-colors"
                  >
                    Resume
                  </button>
                  <button
                    onClick={() => onDelete(s.id)}
                    className="text-[10px] font-medium text-red-500 hover:text-red-700 bg-red-50 py-1 px-2 rounded cursor-pointer transition-colors"
                    title="Delete"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
