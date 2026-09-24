import { describe, expect, it } from 'vitest';

import { FLOW_NODE_IDS } from '../../../lib/flow-model';
import { DIVIDER_X, NODE_BAND, NODE_POS, NODE_W, VIEWBOX } from '../layout';

const [, , WIDTH, HEIGHT] = VIEWBOX.split(' ').map(Number) as [number, number, number, number];

describe('flow diagram layout', () => {
  it('places every node on its own cloud side of the divider', () => {
    for (const id of FLOW_NODE_IDS) {
      const { x } = NODE_POS[id];
      if (NODE_BAND[id] === 'databricks') {
        expect(x, `${id} is a Databricks node and must sit right of the divider`).toBeGreaterThan(
          DIVIDER_X,
        );
      } else {
        expect(x, `${id} is an AWS node and must sit left of the divider`).toBeLessThan(DIVIDER_X);
      }
    }
  });

  it('keeps every node card inside the viewBox', () => {
    for (const id of FLOW_NODE_IDS) {
      const { x, y } = NODE_POS[id];
      expect(x - NODE_W / 2, `${id} overflows the left edge`).toBeGreaterThanOrEqual(0);
      expect(x + NODE_W / 2, `${id} overflows the right edge`).toBeLessThanOrEqual(WIDTH);
      expect(y, `${id} overflows the bottom edge`).toBeLessThan(HEIGHT);
    }
  });
});
