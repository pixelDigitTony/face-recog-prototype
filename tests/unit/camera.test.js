import { describe, expect, it } from 'vitest';
import { openCameraStream } from '@/utils/hooks/faceRecognition/useCamera';

const stream = { id: 'rapoo' };
const missing = () =>
  Object.assign(new Error('Requested device not found'), { name: 'NotFoundError' });

describe('camera opening', () => {
  it('uses a listed camera when the preferred front-camera request finds none', async () => {
    const calls = [];
    const mediaDevices = {
      async getUserMedia(constraints) {
        calls.push(constraints);
        if (constraints.video?.facingMode) throw missing();
        return stream;
      },
      async enumerateDevices() {
        return [{ kind: 'videoinput', deviceId: 'rapoo-1', label: 'rapoo camera' }];
      },
    };
    await expect(openCameraStream(mediaDevices)).resolves.toBe(stream);
    expect(calls[1].video.deviceId).toEqual({ exact: 'rapoo-1' });
    expect(calls.some((call) => call.video?.facingMode === 'user')).toBe(false);
  });

  it('does not keep searching when the camera is busy', async () => {
    let calls = 0;
    const busy = Object.assign(new Error('Could not start video source'), {
      name: 'NotReadableError',
    });
    const mediaDevices = {
      async getUserMedia() {
        calls += 1;
        throw busy;
      },
      enumerateDevices: async () => {
        throw new Error('should not list devices');
      },
    };
    await expect(openCameraStream(mediaDevices)).rejects.toMatchObject({
      name: 'NotReadableError',
    });
    expect(calls).toBe(1);
  });
});
