import { NextRequest } from 'next/server';
import { POST } from '../route';
import { createEmailService } from '@/lib/email/email-service';

jest.mock('@/lib/email/email-service', () => ({
  createEmailService: jest.fn(),
  getInternalEmail: () => 'team@example.com',
}));

const sendEmail = jest.fn();
const close = jest.fn();
const createService = createEmailService as jest.Mock;

function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validRequest = {
  name: 'Ana <Santos>',
  company: 'ONCA',
  email: 'ana@example.com',
  privacyAccepted: true,
};

beforeEach(() => {
  sendEmail.mockReset();
  close.mockReset();
  createService.mockReturnValue({ sendEmail, close });
});

test('rejects malformed data before creating an email service', async () => {
  const response = await POST(request(null));
  expect(response.status).toBe(400);
  expect(createService).not.toHaveBeenCalled();
});

test('sends the internal request and escapes visitor text', async () => {
  sendEmail.mockResolvedValue(true);
  const response = await POST(request(validRequest));
  expect(response.status).toBe(200);
  expect(sendEmail).toHaveBeenCalledTimes(2);
  expect(sendEmail.mock.calls[0][0].to).toBe('team@example.com');
  expect(sendEmail.mock.calls[0][0].html).toContain('Ana &lt;Santos&gt;');
  expect(close).toHaveBeenCalledTimes(1);
});

test('reports success when only the visitor reply fails', async () => {
  sendEmail.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  const response = await POST(request(validRequest));
  expect(response.status).toBe(200);
  expect(close).toHaveBeenCalledTimes(1);
});

test('reports success when the visitor reply throws after internal delivery', async () => {
  sendEmail.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('SMTP unavailable'));
  const response = await POST(request(validRequest));
  expect(response.status).toBe(200);
  expect(close).toHaveBeenCalledTimes(1);
});

test('reports failure when the internal request fails', async () => {
  sendEmail.mockResolvedValue(false);
  const response = await POST(request(validRequest));
  expect(response.status).toBe(502);
  expect(sendEmail).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);
});
