import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeOverallScore,
  DEFAULT_WEIGHTS,
  validateWeights,
} from "../src/lib/ranking.ts";

test("standart og'irliklar 40/25/35", () => {
  assert.deepEqual(DEFAULT_WEIGHTS, {
    achievements: 40,
    monthly_activity: 25,
    active_leadership: 35,
  });
});

test("umumiy ball formulasi", () => {
  // 100 * 0.4 + 100 * 0.25 + 100 * 0.35 = 100
  assert.equal(
    computeOverallScore({ achievements: 100, monthlyActivity: 100, activeLeadership: 100 }),
    100,
  );
  // 50 * 0.4 + 80 * 0.25 + 20 * 0.35 = 20 + 20 + 7 = 47
  assert.equal(
    computeOverallScore({ achievements: 50, monthlyActivity: 80, activeLeadership: 20 }),
    47,
  );
});

test("qo'lda tuzatish qo'shiladi va 0–100 oralig'ida qoladi", () => {
  assert.equal(
    computeOverallScore({
      achievements: 50, monthlyActivity: 50, activeLeadership: 50, manualAdjustment: 10,
    }),
    60,
  );
  assert.equal(
    computeOverallScore({
      achievements: 95, monthlyActivity: 95, activeLeadership: 95, manualAdjustment: 50,
    }),
    100,
  );
  assert.equal(
    computeOverallScore({
      achievements: 5, monthlyActivity: 0, activeLeadership: 0, manualAdjustment: -50,
    }),
    0,
  );
});

test("og'irliklar validatsiyasi", () => {
  assert.equal(validateWeights({ achievements: 40, monthly_activity: 25, active_leadership: 35 }), null);
  assert.ok(validateWeights({ achievements: 50, monthly_activity: 25, active_leadership: 35 }));
  assert.ok(validateWeights({ achievements: -5, monthly_activity: 70, active_leadership: 35 }));
});
