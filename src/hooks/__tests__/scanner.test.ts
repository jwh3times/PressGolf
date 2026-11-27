import { CameraView } from 'expo-camera';
import { scanScorecard } from '../scanner';

const mockDeleted: string[] = [];
const mockFailing = new Set<string>();

jest.mock('expo-camera', () => ({ CameraView: { scanDocumentAsync: jest.fn() } }));
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation((uri: string) => ({
    base64: () => Promise.resolve(`b64:${uri}`),
    delete: () => {
      if (mockFailing.has(uri)) throw new Error('already gone');
      mockDeleted.push(uri);
    },
  })),
}));

const mockScanDocument = CameraView.scanDocumentAsync as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockDeleted.length = 0;
  mockFailing.clear();
});

describe('the phone’s document scanner (#385)', () => {
  it('reads each page as base64 to send, and deletes every page from the phone', async () => {
    mockScanDocument.mockResolvedValue({ pages: ['file:///cache/a.jpg', 'file:///cache/b.png'] });
    await expect(scanScorecard()).resolves.toEqual({
      kind: 'photos',
      photos: [
        { mediaType: 'image/jpeg', data: 'b64:file:///cache/a.jpg' },
        { mediaType: 'image/png', data: 'b64:file:///cache/b.png' },
      ],
    });
    expect(mockScanDocument).toHaveBeenCalledWith({ quality: 0.8 });
    expect(mockDeleted).toEqual(['file:///cache/a.jpg', 'file:///cache/b.png']);
  });

  it('takes up to 4 pages as one scan, and refuses more, deleting them all the same', async () => {
    const pages = Array.from({ length: 5 }, (_, i) => `file:///cache/${i}.jpg`);
    mockScanDocument.mockResolvedValue({ pages: pages.slice(0, 4) });
    await expect(scanScorecard()).resolves.toMatchObject({ kind: 'photos' });
    mockDeleted.length = 0;
    mockScanDocument.mockResolvedValue({ pages });
    await expect(scanScorecard()).resolves.toEqual({ kind: 'too-many', count: 5 });
    expect(mockDeleted).toEqual(pages);
  });

  it('is cancelled when the golfer closes it or it takes no page, and a page already gone is no matter', async () => {
    mockScanDocument.mockResolvedValue(null);
    await expect(scanScorecard()).resolves.toEqual({ kind: 'cancelled' });
    mockScanDocument.mockResolvedValue({ pages: [] });
    await expect(scanScorecard()).resolves.toEqual({ kind: 'cancelled' });
    mockFailing.add('file:///cache/gone.jpg');
    mockScanDocument.mockResolvedValue({ pages: ['file:///cache/gone.jpg'] });
    await expect(scanScorecard()).resolves.toMatchObject({ kind: 'photos' });
  });
});
