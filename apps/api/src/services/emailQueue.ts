/**
 * Email Queue Producer Service (Ticket 06)
 * 
 * Produces email sending jobs to Cloudflare Queue (EMAIL_QUEUE).
 * Supports various email types: OTP, invite, broadcast, thread messages.
 */

export interface EmailJobBase {
  job_id: string;
  type: 'otp' | 'invite' | 'broadcast' | 'thread_message' | 'reminder' | 'finalized' | 'additional_slots' | 'one_on_one';
  to: string;
  subject: string;
  created_at: number;
}

export interface OTPEmailJob extends EmailJobBase {
  type: 'otp';
  data: {
    code: string;
    purpose: string;
    expires_in: number;
  };
}

export interface InviteEmailJob extends EmailJobBase {
  type: 'invite';
  data: {
    token: string;
    inviter_name: string;
    relation_type: string;
    thread_title?: string;  // Beta A: スレッドタイトル（メール本文に表示）
  };
}

export interface BroadcastEmailJob extends EmailJobBase {
  type: 'broadcast';
  data: {
    broadcast_id: string;
    delivery_id: string;
    message: string;
  };
}

export interface ThreadMessageEmailJob extends EmailJobBase {
  type: 'thread_message';
  data: {
    thread_id: string;
    delivery_id: string;
    message: string;
    sender_name: string;
  };
}

export interface ReminderEmailJob extends EmailJobBase {
  type: 'reminder';
  data: {
    token: string;
    invite_url: string;
    thread_title: string;
    inviter_name: string;
    custom_message?: string | null;
    expires_at: string;
    recipient_timezone?: string;  // P3-TZ2: 受信者のタイムゾーン（期限表示用）
    scheduled_reminder_id?: string;  // PR-REMIND-4: 送信完了時に scheduled_reminders を更新するためのID
  };
}

export interface FinalizedEmailJob extends EmailJobBase {
  type: 'finalized';
  data: {
    thread_title: string;
    selected_slot: {
      start_at: string;
      end_at: string;
      timezone: string;
      label?: string | null;
    };
    participants_count: number;
  };
}

// Phase2: 追加候補通知メール
export interface AdditionalSlotsEmailJob extends EmailJobBase {
  type: 'additional_slots';
  data: {
    token: string;
    thread_title: string;
    slot_count: number;
    slot_description: string;
    invite_url: string;
    proposal_version: number;
  };
}

// v1.1: 1対1固定日時招待メール
export interface OneOnOneEmailJob extends EmailJobBase {
  type: 'one_on_one';
  data: {
    token: string;
    organizer_name: string;
    invitee_name: string;
    title: string;
    slot: {
      start_at: string;
      end_at: string;
    };
    message_hint?: string;
  };
}

export type EmailJob = OTPEmailJob | InviteEmailJob | BroadcastEmailJob | ThreadMessageEmailJob | ReminderEmailJob | FinalizedEmailJob | AdditionalSlotsEmailJob | OneOnOneEmailJob;

export class EmailQueueService {
  constructor(
    private readonly queue: Queue<EmailJob>,
    private readonly analytics?: AnalyticsEngineDataset
  ) {}

  /**
   * Send OTP email
   */
  async sendOTPEmail(options: {
    to: string;
    code: string;
    purpose: string;
    expiresIn: number;
  }): Promise<string> {
    const jobId = crypto.randomUUID();
    const job: OTPEmailJob = {
      job_id: jobId,
      type: 'otp',
      to: options.to,
      subject: this.getOTPSubject(options.purpose),
      created_at: Date.now(),
      data: {
        code: options.code,
        purpose: options.purpose,
        expires_in: options.expiresIn,
      },
    };

    await this.queue.send(job);

    // Track analytics
    if (this.analytics) {
      this.analytics.writeDataPoint({
        blobs: ['email_queued', 'otp', options.purpose],
        doubles: [Date.now()],
        indexes: ['email_queue'],
      });
    }

    console.log(`[EmailQueue] Queued OTP email to ${options.to} (${jobId})`);
    return jobId;
  }

  /**
   * Send invite email
   * Beta A: thread_title を追加（メール本文に表示）
   */
  async sendInviteEmail(options: {
    to: string;
    token: string;
    inviterName: string;
    relationType: string;
    threadTitle?: string;  // Beta A: スレッドタイトル
  }): Promise<string> {
    const jobId = crypto.randomUUID();
    const displayTitle = options.threadTitle || '日程調整';
    const job: InviteEmailJob = {
      job_id: jobId,
      type: 'invite',
      to: options.to,
      subject: `【日程調整】${options.inviterName}さんより「${displayTitle}」のご依頼`,
      created_at: Date.now(),
      data: {
        token: options.token,
        inviter_name: options.inviterName,
        relation_type: options.relationType,
        thread_title: options.threadTitle,
      },
    };

    await this.queue.send(job);

    // Track analytics
    if (this.analytics) {
      this.analytics.writeDataPoint({
        blobs: ['email_queued', 'invite', options.relationType],
        doubles: [Date.now()],
        indexes: ['email_queue'],
      });
    }

    console.log(`[EmailQueue] Queued invite email to ${options.to} (${jobId})`);
    return jobId;
  }

  /**
   * Send broadcast email
   */
  async sendBroadcastEmail(options: {
    to: string;
    broadcastId: string;
    deliveryId: string;
    message: string;
  }): Promise<string> {
    const jobId = crypto.randomUUID();
    const job: BroadcastEmailJob = {
      job_id: jobId,
      type: 'broadcast',
      to: options.to,
      subject: 'New broadcast message',
      created_at: Date.now(),
      data: {
        broadcast_id: options.broadcastId,
        delivery_id: options.deliveryId,
        message: options.message,
      },
    };

    await this.queue.send(job);

    // Track analytics
    if (this.analytics) {
      this.analytics.writeDataPoint({
        blobs: ['email_queued', 'broadcast', options.broadcastId],
        doubles: [Date.now()],
        indexes: ['email_queue'],
      });
    }

    console.log(`[EmailQueue] Queued broadcast email to ${options.to} (${jobId})`);
    return jobId;
  }

  /**
   * Send thread message email
   */
  async sendThreadMessageEmail(options: {
    to: string;
    threadId: string;
    deliveryId: string;
    message: string;
    senderName: string;
  }): Promise<string> {
    const jobId = crypto.randomUUID();
    const job: ThreadMessageEmailJob = {
      job_id: jobId,
      type: 'thread_message',
      to: options.to,
      subject: `New message from ${options.senderName}`,
      created_at: Date.now(),
      data: {
        thread_id: options.threadId,
        delivery_id: options.deliveryId,
        message: options.message,
        sender_name: options.senderName,
      },
    };

    await this.queue.send(job);

    // Track analytics
    if (this.analytics) {
      this.analytics.writeDataPoint({
        blobs: ['email_queued', 'thread_message', options.threadId],
        doubles: [Date.now()],
        indexes: ['email_queue'],
      });
    }

    console.log(`[EmailQueue] Queued thread message email to ${options.to} (${jobId})`);
    return jobId;
  }

  /**
   * v1.1: 1対1固定日時の招待メール送信
   * 「【日程確認】◯◯さんから打ち合わせのご依頼」
   */
  async sendOneOnOneEmail(options: {
    to: string;
    token: string;
    organizerName: string;
    inviteeName: string;
    title: string;
    slot: {
      start_at: string;
      end_at: string;
    };
    messageHint?: string;
  }): Promise<string> {
    const jobId = crypto.randomUUID();
    const job: OneOnOneEmailJob = {
      job_id: jobId,
      type: 'one_on_one',
      to: options.to,
      subject: `【日程確認】${options.organizerName}さんから「${options.title}」のご依頼`,
      created_at: Date.now(),
      data: {
        token: options.token,
        organizer_name: options.organizerName,
        invitee_name: options.inviteeName,
        title: options.title,
        slot: options.slot,
        message_hint: options.messageHint,
      },
    };

    await this.queue.send(job);

    // Track analytics
    if (this.analytics) {
      this.analytics.writeDataPoint({
        blobs: ['email_queued', 'one_on_one', options.token],
        doubles: [Date.now()],
        indexes: ['email_queue'],
      });
    }

    console.log(`[EmailQueue] Queued 1-on-1 invite email to ${options.to} (${jobId})`);
    return jobId;
  }

  /**
   * Get email subject based on OTP purpose
   */
  private getOTPSubject(purpose: string): string {
    switch (purpose) {
      case 'email_verify':
        return 'Verify your email address';
      case 'password_reset':
        return 'Reset your password';
      case 'invite_accept':
        return 'Accept your invitation';
      case 'login':
        return 'Sign in to your account';
      default:
        return 'Your verification code';
    }
  }
}
