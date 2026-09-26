// The game's music (G12): one list, read by the recorder (tools/make-music.py
// — ElevenLabs' music generation, from these prompts, into
// public/audio/music/<moment>-<n>.ogg, each cut into a seamless loop of whole
// bars) and by the game (engine/audio.ts setMusic), which plays each moment's
// tracks in turn — shuffled, a couple of minutes each — and crossfades from
// one to the next, and from moment to moment.

export interface MusicDef {
  /** what to ask for (English works best); every prompt asks for a steady
   * groove without an intro, an ending or a fade, so a long loop can be cut */
  prompt: string;
  /** the tempo the prompt asks for (the recorder reports the loop in beats) */
  bpm: number;
  /** its length (s) — ElevenLabs charges per minute (~900 credits) */
  seconds: number;
  /** bump to record the track again from the same prompt (a take nobody liked) */
  take?: number;
}

const LOOP = 'instrumental, steady groove from the first beat to the last, no intro, no ending, no fade, made to loop';

const GARAGE = `Cheerful, bouncy music for a children's game menu, a toy garage full of vehicles: ukulele, glockenspiel, handclaps, light drums, playful bass, major key, 110 BPM, ${LOOP}`;
const DAY = `Sunny, upbeat adventure music for a children's driving game, exploring a little island city by day: acoustic guitar strums, bright piano, marimba melody, bouncy bass, light drums with shaker, major key, happy and carefree, 118 BPM, ${LOOP}`;
const NIGHT = `Calm, warm night-time music for a children's driving game, a little city lit up under the stars: soft electric piano, music box and celesta twinkles, gentle pads, soft brushed drums, round bass, major key, dreamy but still moving along, 92 BPM, ${LOOP}`;
const RACE = `Energetic, exciting race music for a children's kart racing game: driving drums, funky bass, bright synth brass stabs, electric guitar riffs, major key, fun and fast but never aggressive, 150 BPM, ${LOOP}`;
const CHASE = `Playful cartoon police-chase music for a children's game, sneaky and fun: pizzicato strings, walking upright bass, bongos and snare, cheeky clarinet and muted trumpet melody, spy-caper feel, light-hearted, 128 BPM, ${LOOP}`;
const SCENE = `Brave, hopeful little-hero music for a children's rescue mission, putting out a fire and saving a kitten: light marching snare, bright brass and strings, glockenspiel, determined but cheerful, major key, 112 BPM, ${LOOP}`;

/** each moment's tracks (the first two are two takes of one prompt, the
 * others their own sound in the same mood) */
export const MUSIC = {
  // the garage: choosing a vehicle
  garage: [
    { prompt: GARAGE, bpm: 110, seconds: 60 },
    { prompt: GARAGE, bpm: 110, seconds: 60, take: 2 },
    { prompt: `Happy, sunny music for a children's game menu, a toy workshop: whistled melody, xylophone, acoustic guitar, bouncy tuba bass, light drums and claps, major key, 104 BPM, ${LOOP}`, bpm: 104, seconds: 60 },
    { prompt: `Playful, curious music for a children's game menu, toy cars lined up to be chosen: pizzicato strings, celesta, soft marimba, woodblocks, light shaker, major key, 100 BPM, ${LOOP}`, bpm: 100, seconds: 60 },
  ],
  // driving (and flying, sailing, riding the train) round the island
  day: [
    { prompt: DAY, bpm: 118, seconds: 120 },
    { prompt: DAY, bpm: 118, seconds: 120, take: 2 },
    { prompt: `Bright, breezy summer adventure music for a children's driving game along the seaside: ukulele, steel drums, bouncy bass, handclaps, light drums, major key, 112 BPM, ${LOOP}`, bpm: 112, seconds: 120 },
    { prompt: `Cheerful, sunny road-trip music for a children's game: electric piano, funky clean guitar, whistled melody, groovy bass, light drums, major key, 120 BPM, ${LOOP}`, bpm: 120, seconds: 120 },
  ],
  night: [
    { prompt: NIGHT, bpm: 92, seconds: 120 },
    { prompt: NIGHT, bpm: 92, seconds: 120, take: 2 },
    { prompt: `Gentle, cozy night-drive music for a children's game under the moon: soft nylon guitar, vibraphone, warm pads, gentle bass, soft brushed drums, major key, 86 BPM, ${LOOP}`, bpm: 86, seconds: 120, take: 2 },
    { prompt: `Soft, magical starry-night music for a children's game: harp arpeggios, glockenspiel, soft strings, round bass, light shaker, major key, peaceful but moving along, 90 BPM, ${LOOP}`, bpm: 90, seconds: 120 },
  ],
  // the race islands
  race: [
    { prompt: RACE, bpm: 150, seconds: 90 },
    { prompt: RACE, bpm: 150, seconds: 90, take: 2 },
    { prompt: `Fast, exciting arcade race music for a children's kart game: chiptune leads over real drums, punchy synth bass, bright arpeggios, major key, fun, 160 BPM, ${LOOP}`, bpm: 160, seconds: 90 },
    { prompt: `Upbeat racing music for a children's kart game: surf-rock guitar, driving drums, organ stabs, galloping bass, major key, joyful and fast, 145 BPM, ${LOOP}`, bpm: 145, seconds: 90 },
  ],
  // the police car and the police helicopter chasing the getaway cars
  chase: [
    { prompt: CHASE, bpm: 128, seconds: 90 },
    { prompt: CHASE, bpm: 128, seconds: 90, take: 2 },
    { prompt: `Cheeky cartoon chase music for a children's police game, tiptoeing then running: bassoon and clarinet melody, pizzicato strings, brushed snare, xylophone runs, light-hearted, 132 BPM, ${LOOP}`, bpm: 132, seconds: 90 },
    { prompt: `Funky, playful cop-show music for a children's game: wah guitar, brass hits, groovy bass, bongos, light drums, fun and never scary, 120 BPM, ${LOOP}`, bpm: 120, seconds: 90 },
  ],
  // a mission's own scene: the fire, the cat, the patient, the rescue (each
  // scene the next track)
  scene: [
    { prompt: SCENE, bpm: 112, seconds: 60 },
    { prompt: SCENE, bpm: 112, seconds: 60, take: 2 },
    { prompt: `Cheerful, encouraging helper music for a children's rescue mission: pizzicato strings, glockenspiel, light snare, warm horns, major key, 116 BPM, ${LOOP}`, bpm: 116, seconds: 60 },
    { prompt: `Happy, can-do little-hero music for a children's game mission: ukulele, whistling, handclaps, marching bass drum, trumpet melody, major key, 108 BPM, ${LOOP}`, bpm: 108, seconds: 60 },
  ],
} satisfies Record<string, MusicDef[]>;

export type MusicId = keyof typeof MUSIC;

/** a moment's n-th track (0-based), as its file's name */
export const trackFile = (id: MusicId, n: number): string => `${id}-${n + 1}`;
