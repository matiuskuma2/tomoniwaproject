/**
 * Candidate Generator Service
 * 
 * Generates candidate strangers for 1-to-1 matching using AI
 */

import { AIRouterService } from './aiRouter';

export interface Candidate {
  name: string;
  email: string;
  reason: string;
}

export class CandidateGeneratorService {
  constructor(
    private aiRouter: AIRouterService,
    private userId: string,
    private roomId?: string
  ) {}

  /**
   * Generate 3 candidate strangers for a thread
   * 
   * @param threadTitle Thread title/topic
   * @param threadDescription Optional thread description
   * @returns Array of 3 candidates
   * 
   * NOTE: Currently using fallback candidates for E2E testing.
   * The quality of candidates doesn't matter for Phase 2 E2E flow verification.
   * What matters is:
   * 1. Email sending works (Queue → Resend → Domain verification)
   * 2. /i/:token page displays correctly
   * 3. Accept flow creates inbox notification
   * 
   * AI-powered dynamic candidate generation can be integrated later
   * by uncommenting the AI Router integration below.
   */
  async generateCandidates(
    threadTitle: string,
    threadDescription?: string
  ): Promise<Candidate[]> {
    const prompt = this.buildPrompt(threadTitle, threadDescription);

    // For now, use fallback candidates for E2E testing
    // TODO: Integrate with AI Router for production quality candidates
    // const response = await this.aiRouter.generateContent({
    //   feature: 'candidate_generation',
    //   prompt,
    //   temperature: 0.9,
    // });
    // return this.parseCandidates(response);
    
    return this.generateFallbackCandidates(prompt);
  }

  /**
   * Build prompt for candidate generation
   */
  private buildPrompt(title: string, description?: string): string {
    return `You are an AI assistant helping to find interesting strangers for a 1-to-1 conversation thread.

Thread Topic: "${title}"
${description ? `Description: ${description}` : ''}

Generate exactly 3 diverse candidate strangers who would be interesting to connect with on this topic. For each candidate, provide:
1. A plausible name (diverse backgrounds)
2. A realistic email address (format: firstname.lastname@example.com)
3. A compelling reason why this person would be interesting (2-3 sentences)

Format your response as JSON:
{
  "candidates": [
    {
      "name": "Full Name",
      "email": "email@example.com",
      "reason": "Compelling reason why this person is interesting..."
    }
  ]
}

Focus on:
- Diverse backgrounds, perspectives, and expertise
- People who can provide unique insights on the topic
- Realistic and engaging profiles
- Professional yet approachable tone

Generate the JSON response now:`;
  }

  /**
   * Parse AI response into candidates
   */
  private parseCandidates(content: string): Candidate[] {
    try {
      // Try to extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const data = JSON.parse(jsonMatch[0]);
      
      if (!data.candidates || !Array.isArray(data.candidates)) {
        throw new Error('Invalid candidates format');
      }

      // Validate and normalize candidates
      const candidates: Candidate[] = data.candidates
        .slice(0, 3) // Ensure max 3 candidates
        .map((c: any) => ({
          name: String(c.name || 'Unknown').trim(),
          email: String(c.email || 'unknown@example.com').trim().toLowerCase(),
          reason: String(c.reason || 'Interesting perspective').trim(),
        }))
        .filter((c: Candidate) => 
          c.name !== 'Unknown' && 
          c.email.includes('@') && 
          c.reason.length > 10
        );

      if (candidates.length < 3) {
        throw new Error('Insufficient valid candidates');
      }

      return candidates;
    } catch (error) {
      console.error('[CandidateGenerator] Parse error:', error);
      
      // Fallback: Generate dummy candidates
      return this.generateFallbackCandidates(content);
    }
  }

  /**
   * Generate fallback candidates if AI parsing fails
   */
  private generateFallbackCandidates(aiContent: string): Candidate[] {
    const timestamp = Date.now();
    
    return [
      {
        name: 'Alex Johnson',
        email: `alex.johnson.${timestamp}@example.com`,
        reason: 'Experienced professional with diverse perspectives on the topic. Known for thoughtful insights and engaging conversations.',
      },
      {
        name: 'Maria Garcia',
        email: `maria.garcia.${timestamp}@example.com`,
        reason: 'Creative thinker with international background. Brings unique cultural insights and fresh approaches to discussions.',
      },
      {
        name: 'David Chen',
        email: `david.chen.${timestamp}@example.com`,
        reason: 'Technical expert with strong communication skills. Excellent at explaining complex concepts in accessible ways.',
      },
    ];
  }
}
