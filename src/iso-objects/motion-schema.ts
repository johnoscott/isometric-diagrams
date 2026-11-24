// The motion document's JSON Schema, for editors (completion, hover) and for tools; checkMotion (motion-doc.ts) says the same, with
// places. A module of its own: a page that plays a document doesn't carry it.

import { ASSEMBLE_STYLES, DISASSEMBLE_STYLES, MOTION_ORDERS } from './motion.ts';
import { EASING_NAMES, EXTRAPOLATE } from './motion-doc.ts';

const TIME = { anyOf: [{ type: 'number' }, { type: 'string', pattern: '^-?\\d+(\\.\\d+)?(ms|s|f)?$' }] } as const;
const IDS = { type: 'array', items: { type: 'string' } } as const;
const EASE = { anyOf: [{ enum: EASING_NAMES }, { type: 'object', required: ['bezier'], additionalProperties: false, properties: { bezier: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 } } }, { type: 'object', required: ['spring'], additionalProperties: false, properties: { spring: { $ref: '#/$defs/spring' } } }] } as const;
const timing = { from: { $ref: '#/$defs/time' }, duration: { $ref: '#/$defs/time' }, easing: { $ref: '#/$defs/ease' } };
const node = (key: string, value: object, more: object = {}, withTiming = true) => ({ type: 'object', required: [key], additionalProperties: false, properties: { [key]: value, ...(withTiming ? timing : {}), ...more } });
export const MOTION_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'isomotion/1',
  type: 'object', required: ['isomotion'], additionalProperties: false,
  properties: {
    isomotion: { const: 1 }, fps: { type: 'number', exclusiveMinimum: 0, description: 'Frames a second, for lengths written "30f".' }, seed: { type: 'integer' },
    ambient: { enum: ['on', 'off'], description: 'Off: the ants and the looping tokens and pulses stand still, each at its start.' },
    series: { $ref: '#/$defs/series' }, layers: { $ref: '#/$defs/nodes' },
    markers: { type: 'object', additionalProperties: { anyOf: [{ type: 'number' }, { type: 'string' }] } },
  },
  $defs: {
    time: TIME, ids: IDS, ease: EASE,
    spring: { type: 'object', additionalProperties: false, properties: { mass: { type: 'number', exclusiveMinimum: 0 }, damping: { type: 'number', exclusiveMinimum: 0 }, stiffness: { type: 'number', exclusiveMinimum: 0 }, overshootClamping: { type: 'boolean' } } },
    curve: { type: 'object', required: ['times', 'values'], additionalProperties: false, properties: { times: { type: 'array', items: { $ref: '#/$defs/time' }, minItems: 1 }, values: { type: 'array', items: { type: 'number' }, minItems: 1 }, easing: { $ref: '#/$defs/ease' }, extrapolateLeft: { enum: EXTRAPOLATE }, extrapolateRight: { enum: EXTRAPOLATE } } },
    say: { type: 'object', additionalProperties: false, properties: { chapter: { type: 'string' }, title: { type: 'string' }, text: { type: 'string' }, code: { type: 'string' }, color: { type: 'string' }, facts: { type: 'array', items: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2 } } } },
    focus: { type: 'object', required: ['lit'], additionalProperties: false, properties: { lit: { $ref: '#/$defs/ids' }, scope: { enum: ['all', 'links'] }, level: { type: 'number', minimum: 0, maximum: 1 }, always: { $ref: '#/$defs/ids' } } },
    sequence: {
      type: 'object', additionalProperties: false, properties: {
        name: { type: 'string', pattern: '^[A-Za-z][\\w-]*$' }, from: { $ref: '#/$defs/time' }, offset: { $ref: '#/$defs/time' }, trimBefore: { $ref: '#/$defs/time' },
        duration: { anyOf: [{ $ref: '#/$defs/time' }, { type: 'object', required: ['read'], additionalProperties: false, properties: { read: { anyOf: [{ const: true }, { type: 'object', additionalProperties: false, properties: { base: { type: 'number' }, perChar: { type: 'number' }, min: { type: 'number' }, max: { type: 'number' } } }] } } }] },
        loop: { anyOf: [{ type: 'boolean' }, { type: 'integer', minimum: 1 }] }, playbackRate: { type: 'number', exclusiveMinimum: 0 },
        say: { $ref: '#/$defs/say' }, show: { $ref: '#/$defs/ids' }, hide: { $ref: '#/$defs/ids' }, focus: { $ref: '#/$defs/focus' }, highlight: { $ref: '#/$defs/ids' }, levels: { type: 'object', additionalProperties: { type: 'number', minimum: 0, maximum: 1 } }, variants: { type: 'object', additionalProperties: { type: 'string' } },
        enter: { type: 'object', required: ['fade'], additionalProperties: false, properties: { fade: { $ref: '#/$defs/time' }, easing: { $ref: '#/$defs/ease' } } },
        ants: { anyOf: [{ type: 'boolean' }, { $ref: '#/$defs/ids' }] }, children: { $ref: '#/$defs/nodes' }, layers: { $ref: '#/$defs/nodes' }, series: { $ref: '#/$defs/series' },
      },
    },
    series: { type: 'array', items: { anyOf: [{ $ref: '#/$defs/seq' }, node('transition', { type: 'object', required: ['presentation', 'timing'], additionalProperties: false, properties: { presentation: { enum: ['fade', 'none'] }, timing: { anyOf: [{ type: 'object', required: ['linear'], additionalProperties: false, properties: { linear: { $ref: '#/$defs/time' } } }, { type: 'object', required: ['spring'], additionalProperties: false, properties: { spring: { type: 'object', additionalProperties: false, properties: { mass: { type: 'number', exclusiveMinimum: 0 }, damping: { type: 'number', exclusiveMinimum: 0 }, stiffness: { type: 'number', exclusiveMinimum: 0 }, overshootClamping: { type: 'boolean' }, duration: { $ref: '#/$defs/time' } } } } }] } } }, {}, false)] } },
    seq: node('sequence', { $ref: '#/$defs/sequence' }, {}, false),
    plan: { type: 'object' },
    nodes: {
      type: 'array', items: { anyOf: [
        { $ref: '#/$defs/seq' }, node('series', { $ref: '#/$defs/series' }, {}, false), node('layers', { $ref: '#/$defs/nodes' }, {}, false),
        node('assemble', { type: 'object', properties: { style: { enum: ASSEMBLE_STYLES }, order: { enum: MOTION_ORDERS } } }), node('disassemble', { type: 'object', properties: { style: { enum: DISASSEMBLE_STYLES }, order: { enum: MOTION_ORDERS } } }),
        node('travel', { type: 'array', items: { anyOf: [{ type: 'string' }, { $ref: '#/$defs/ids' }] }, minItems: 1 }, { each: { $ref: '#/$defs/time' }, hold: { $ref: '#/$defs/time' }, loop: { type: 'boolean' } }),
        node('pulse', { $ref: '#/$defs/ids' }, { loop: { type: 'boolean' } }),
        node('ants', { anyOf: [{ const: true }, { $ref: '#/$defs/ids' }] }, { speed: { type: 'number' }, dash: { type: 'array', items: { type: 'number', exclusiveMinimum: 0 }, minItems: 2, maxItems: 2 } }),
        node('draw', { $ref: '#/$defs/ids' }, { by: { enum: ['stroke', 'grow'] }, stagger: { $ref: '#/$defs/time' } }), node('type', { $ref: '#/$defs/ids' }),
        { type: 'object', required: ['move'], additionalProperties: false, properties: { move: { type: 'string' }, from: { $ref: '#/$defs/time' }, x: { $ref: '#/$defs/curve' }, y: { $ref: '#/$defs/curve' }, scale: { $ref: '#/$defs/curve' }, opacity: { $ref: '#/$defs/curve' } } },
        { type: 'object', required: ['lift', 'by'], additionalProperties: false, properties: { lift: { $ref: '#/$defs/ids' }, by: { type: 'number' }, stagger: { $ref: '#/$defs/time' }, to: { enum: ['up', 'down'] }, opacity: { $ref: '#/$defs/curve' }, ...timing } },
        node('focus', { $ref: '#/$defs/focus' }, { fade: { $ref: '#/$defs/time' } }), node('highlight', { $ref: '#/$defs/ids' }, { fade: { $ref: '#/$defs/time' } }),
        node('camera', { anyOf: [{ const: 'fit' }, { type: 'object', required: ['focus'], additionalProperties: false, properties: { focus: { anyOf: [{ type: 'string' }, { $ref: '#/$defs/ids' }, { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 }] }, zoom: { type: 'number', exclusiveMinimum: 0 }, margin: { type: 'number' } } }] }),
      ] },
    },
  },
} as const;
