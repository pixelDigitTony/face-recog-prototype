export async function acquireWriterLock(name, locks = globalThis.navigator?.locks) {
  if (!locks)
    return {
      writable: false,
      reason: 'This browser does not support Web Locks. Data is read-only.',
      release() {},
    };
  return new Promise((resolve, reject) => {
    locks
      .request(name, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve({
            writable: false,
            reason: 'Another tab is editing this database. Close it, then reload to edit here.',
            release() {},
          });
          return;
        }
        return new Promise((release) => resolve({ writable: true, reason: null, release }));
      })
      .catch(reject);
  });
}
