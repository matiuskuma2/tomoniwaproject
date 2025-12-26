/**
 * Email Queue Producer Service (Ticket 06)
 * 
 * Produces email sending jobs to Cloudflare Queue (EMAIL_QUEUE).
 * Supports various email types: OTP, invite, broadcast, thread messages.
 */

export interface EmailJobBase {
  job_id: string;
  type: 'otp' | 'invite' | 'broadcast' | 'thread_message' | 'reminder' | 'finalized';
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

export type EmailJob = OTPEmailJob | InviteEmailJob | BroadcastEmailJob | ThreadMessageEmailJob | ReminderEmailJob | FinalizedEmailJob;

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
   */
  async sendInviteEmail(options: {
    to: string;
    token: string;
    inviterName: string;
    relationType: string;
  }): Promise<string> {
    const jobId = crypto.randomUUID();
    const job: InviteEmailJob = {
      job_id: jobId,
      type: 'invite',
      to: options.to,
      subject: `${options.inviterName} wants to connect with you`,
      created_at: Date.now(),
      data: {
        token: options.token,
        inviter_name: options.inviterName,
        relation_type: options.relationType,
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
