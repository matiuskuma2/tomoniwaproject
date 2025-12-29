/**
 * MeetCard
 * Displays Meet URL and calendar_event_id
 * Only shown when thread.status === 'confirmed' && evaluation.meeting exists
 */

import type { ThreadStatus_API } from '../../core/models';

interface MeetCardProps {
  status: ThreadStatus_API;
}

export function MeetCard({ status }: MeetCardProps) {
  // Only show if confirmed and meeting exists
  if (status.thread.status !== 'confirmed' || !status.evaluation.meeting) {
    return null;
  }

  const meeting = status.evaluation.meeting;

  return (
    <div className="bg-white rounded-lg shadow p-4 mb-4 border-l-4 border-green-500">
      <h3 className="text-lg font-semibold text-gray-900 mb-3">
        <span className="inline-flex items-center">
          <svg className="w-5 h-5 mr-2 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          確定済み
        </span>
      </h3>
      
      <div className="space-y-3">
        <div className="bg-green-50 p-3 rounded-lg">
          <span className="text-sm font-medium text-gray-700">Google Meet URL:</span>
          <a 
            href={meeting.url} 
            target="_blank" 
            rel="noopener noreferrer"
            className="block mt-1 text-sm text-blue-600 hover:text-blue-800 underline break-all"
          >
            {meeting.url}
          </a>
        </div>

        {meeting.calendar_event_id && (
          <div className="text-xs text-gray-500">
            <span className="font-medium">カレンダーイベントID:</span>
            <div className="mt-1 font-mono text-xs break-all">
              {meeting.calendar_event_id}
            </div>
          </div>
        )}

        <div className="pt-3 border-t border-gray-200">
          <p className="text-xs text-gray-600">
            ✅ この予定はGoogleカレンダーに追加されています
          </p>
        </div>
      </div>
    </div>
  );
}
