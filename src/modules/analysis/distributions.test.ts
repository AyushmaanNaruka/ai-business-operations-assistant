import { describe, expect, it } from 'vitest';
import { logGamma, normalTwoSidedP, regularizedIncompleteBeta, studentTTwoSidedP } from './distributions';

// Reference values from scipy.stats (t.sf, norm.sf, special.betainc).
describe('distributions', () => {
  it('logGamma matches factorials', () => {
    expect(logGamma(5)).toBeCloseTo(Math.log(24), 12);
    expect(logGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 12);
  });

  it('regularizedIncompleteBeta hits its closed forms', () => {
    // I_x(1, 1) = x and I_x(a, b) + I_(1-x)(b, a) = 1.
    expect(regularizedIncompleteBeta(0.3, 1, 1)).toBeCloseTo(0.3, 12);
    expect(regularizedIncompleteBeta(0.2, 2.5, 4) + regularizedIncompleteBeta(0.8, 4, 2.5)).toBeCloseTo(1, 12);
    expect(regularizedIncompleteBeta(0, 2, 3)).toBe(0);
    expect(regularizedIncompleteBeta(1, 2, 3)).toBe(1);
  });

  it('studentTTwoSidedP matches scipy', () => {
    expect(studentTTwoSidedP(2, 10)).toBeCloseTo(0.0733880347707404, 8);
    expect(studentTTwoSidedP(-2, 10)).toBeCloseTo(0.0733880347707404, 8);
    expect(studentTTwoSidedP(1, 1)).toBeCloseTo(0.5, 10); // Cauchy: P(|T| > 1) = 1/2
    expect(studentTTwoSidedP(3.5, 2.7)).toBeCloseTo(0.04652560492194132, 7); // fractional df, as Welch gives
    expect(studentTTwoSidedP(0, 5)).toBeCloseTo(1, 12);
  });

  it('normalTwoSidedP matches scipy', () => {
    expect(normalTwoSidedP(1.96)).toBeCloseTo(0.04999579029644087, 6);
    expect(normalTwoSidedP(0)).toBeCloseTo(1, 6);
    // A large z keeps a relative, not only absolute, accuracy.
    expect(normalTwoSidedP(6) / 1.973175290075e-9).toBeCloseTo(1, 5);
  });
});
