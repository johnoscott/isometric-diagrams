import type { MotionDoc } from '@johnoscott/isometric-engine/motion';

export const DRAWING = `isodiag: 1
scenes:
  - id: shop
    title: A small shop
    nodes:
      - { id: web, asset: monitor, label: Web, sub: 'app.example' }
      - { id: api, asset: block, label: Orders API, right-of: web, gap: 3 }
      - { id: db, asset: volume, label: Orders, right-of: api, gap: 3 }
    routes:
      - { id: ask, from: web, to: api, kind: send }
      - { id: keep, from: api, to: db, kind: send }
`;

export const MOTION: MotionDoc = {
  isomotion: 1,
  series: [
    { sequence: { name: 'web', duration: 2000, show: ['web'], say: { text: 'A customer opens the shop.' } } },
    { transition: { presentation: 'fade', timing: { linear: 400 } } },
    { sequence: { name: 'api', duration: 2600, show: ['api', 'ask'], children: [{ travel: ['ask'] }], say: { text: 'Their order goes to the API.' } } },
    { transition: { presentation: 'fade', timing: { linear: 400 } } },
    { sequence: { name: 'orders', duration: 2600, show: ['db', 'keep'], children: [{ travel: ['keep'] }], say: { text: 'And it is kept.' } } },
  ],
};
