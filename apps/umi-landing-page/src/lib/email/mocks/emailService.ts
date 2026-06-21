// Mock para EmailService en tests
jest.mock("../email/emailService", () => ({
  getEmailService: jest.fn(() => ({
    sendEmail: jest.fn().mockResolvedValue(true),
    sendTestEmail: jest.fn().mockResolvedValue(true),
    testConnection: jest.fn().mockResolvedValue(true),
    getMetrics: jest.fn().mockReturnValue({ sent: 0, failed: 0 }),
    resetMetrics: jest.fn(),
    close: jest.fn(),
  })),
  EmailService: jest.fn().mockImplementation(() => ({
    sendEmail: jest.fn().mockResolvedValue(true),
    sendTestEmail: jest.fn().mockResolvedValue(true),
    testConnection: jest.fn().mockResolvedValue(true),
    getMetrics: jest.fn().mockReturnValue({ sent: 0, failed: 0 }),
    resetMetrics: jest.fn(),
    close: jest.fn(),
  })),
}));

// Mock para SequenceManager en tests
jest.mock("../email/sequenceManager", () => ({
  getSequenceManager: jest.fn(() => ({
    addSequence: jest.fn(),
    processLeadSequences: jest.fn().mockResolvedValue({ sent: 0, failed: 0 }),
    testSequence: jest.fn().mockResolvedValue(true),
    getMetrics: jest.fn().mockReturnValue({
      totalLeads: 0,
      emailsSent: 0,
      emailsFailed: 0,
      responsesReceived: 0,
      meetingsScheduled: 0,
      conversions: 0,
      sequenceCompletions: 0,
    }),
    resetMetrics: jest.fn(),
    pauseSequenceForLead: jest.fn().mockResolvedValue(true),
    resumeSequenceForLead: jest.fn().mockResolvedValue(true),
  })),
  SequenceManager: jest.fn().mockImplementation(() => ({
    addSequence: jest.fn(),
    processLeadSequences: jest.fn().mockResolvedValue({ sent: 0, failed: 0 }),
    testSequence: jest.fn().mockResolvedValue(true),
    getMetrics: jest.fn().mockReturnValue({
      totalLeads: 0,
      emailsSent: 0,
      emailsFailed: 0,
      responsesReceived: 0,
      meetingsScheduled: 0,
      conversions: 0,
      sequenceCompletions: 0,
    }),
    resetMetrics: jest.fn(),
    pauseSequenceForLead: jest.fn().mockResolvedValue(true),
    resumeSequenceForLead: jest.fn().mockResolvedValue(true),
  })),
}));
