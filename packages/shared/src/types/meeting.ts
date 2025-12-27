/**
 * Meeting Provider Types
 */

export const MEETING_PROVIDER = {
  GOOGLE_MEET: 'google_meet',
  ZOOM: 'zoom',
  TEAMS: 'teams',
} as const;

export type MeetingProvider = typeof MEETING_PROVIDER[keyof typeof MEETING_PROVIDER];

/**
 * Meeting information returned in finalize response
 */
export interface Meeting {
  provider: MeetingProvider;
  url: string;
  calendar_event_id?: string;
}
