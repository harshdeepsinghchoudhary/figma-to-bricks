import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyNativeMarkup } from '../tools/native-integration.mjs';

test('backend probe records nestable placeholders as unverified instead of claiming complete frontend behavior', () => {
  const tree = [{ id: 'aaaaaa', name: 'nav-nested', settings: { ariaLabel: 'Main', mobileMenu: 'mobile_landscape' }, children: ['bbbbbb'] }];
  const rendered = { html: '<nav id="brxe-aaaaaa" class="brxe-nav-nested" aria-label="Main" data-toggle="mobile_landscape"><div class="brx-nestable-children-placeholder"></div></nav>' };
  const report = verifyNativeMarkup(tree, rendered);
  assert.equal(report.status, 'partial');
  assert.equal(report.failures.length, 0);
  assert.equal(report.frontendBehaviorVerified, false);
  assert.match(report.unverified[0], /placeholder/);
});

test('backend probe verifies rendered native slider options and catches wrong native values', () => {
  const tree = [{ id: 'bbbbbb', name: 'slider-nested', settings: { perPage: '3', type: 'loop', 'perPage:tablet_custom': '2' }, children: ['cccccc'] }];
  const options = JSON.stringify({ perPage: 1, type: 'loop', breakpoints: { 1000: { perPage: 2 } } }).replace(/"/g, '&quot;');
  const rendered = { html: `<div id="brxe-bbbbbb" class="brxe-slider-nested" data-splide="${options}"><div class="splide__track"><div class="splide__list"><div class="splide__slide"></div></div></div></div>` };
  const report = verifyNativeMarkup(tree, rendered, { breakpoints: { breakpoints: [{ key: 'tablet_custom', width: 1000 }] } });
  assert.equal(report.status, 'failed');
  assert.deepEqual(report.failures, ['slider-nested bbbbbb: Native Splide perPage matches settings']);
});
