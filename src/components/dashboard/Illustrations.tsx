import React from 'react';
import coins from '../../assets/icons3d/coins.webp';
import gem from '../../assets/icons3d/gem.webp';
import shield from '../../assets/icons3d/shield.webp';
import orbit from '../../assets/icons3d/orbit.webp';
import robot from '../../assets/icons3d/robot.webp';
import radar from '../../assets/icons3d/radar.webp';
import clock from '../../assets/icons3d/clock.webp';
import network from '../../assets/icons3d/network.webp';
import badge from '../../assets/icons3d/badge.webp';
import medal from '../../assets/icons3d/medal.webp';

/**
 * Artwork for the client dashboard: one realistic picture per section (see src/assets/icons3d/README.md for where they
 * come from). Everything here is decorative (aria-hidden) and carries NO data: figures and charts live elsewhere and
 * are always computed from the account's real numbers.
 */

type ArtProps = { size?: number; className?: string };

/** One picture, drawn at the size asked for (the files are 192px, sharp up to 96px on a high-density screen). */
const picture = (src: string): React.FC<ArtProps> =>
  function Art({ size = 120, className = '' }) {
    return <img src={src} alt="" aria-hidden width={size} height={size} draggable={false} decoding="async" className={`art object-contain select-none ${className}`} />;
  };

/* ---------------------------------------------------------------- registry used by stat cards, section banners and action cards */
export const ART = {
  coins: picture(coins), // balance: gold bars
  gem: picture(gem), // equity: a cut sapphire
  shield: picture(shield), // free margin: a steel shield
  orbit: picture(orbit), // floating profit and loss: a brass bull
  robot: picture(robot),
  radar: picture(radar), // active trades: a satellite dish
  clock: picture(clock), // trade history, a payment that is due: an hourglass
  network: picture(network), // referrals: two linked gold rings
  badge: picture(badge), // profile: a card wallet
  medal: picture(medal), // service plan: a medal
} as const;
export type ArtName = keyof typeof ART;
