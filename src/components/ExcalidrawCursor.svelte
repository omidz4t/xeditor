<script lang="ts">
  import type { PeerPresence } from '../collab/presence'

  let {
    peer,
    x,
    y,
  }: {
    peer: PeerPresence
    x: number
    y: number
  } = $props()
</script>

<div
  class="excal-cursor"
  style="transform: translate({x}px, {y}px); --cursor-color: {peer.color}"
>
  {#if peer.pointer?.button === 'down'}
    <div class="excal-click-ring"></div>
  {/if}

  <svg
    class="excal-arrow"
    width="12"
    height="15"
    viewBox="0 0 12 15"
    fill="none"
    aria-hidden="true"
  >
    <path
      class="excal-arrow-outline"
      d="M0 0 L0 14 L4 9 L11 8 Z"
      fill="#ffffff"
      stroke="#ffffff"
      stroke-width="3"
      stroke-linejoin="round"
    />
    <path
      class="excal-arrow-fill"
      d="M0 0 L0 14 L4 9 L11 8 Z"
      fill={peer.color}
      stroke={peer.color}
      stroke-width="1.5"
      stroke-linejoin="round"
    />
  </svg>

  <span class="excal-name">{peer.name}</span>
</div>

<style>
  .excal-cursor {
    position: absolute;
    top: 0;
    left: 0;
    /* Snap transforms — motion comes from high-frequency P2P updates, not CSS lag. */
    will-change: transform;
    pointer-events: none;
    transition: none;
  }

  .excal-click-ring {
    position: absolute;
    left: -4px;
    top: -4px;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: 2px solid rgb(255 255 255 / 0.55);
    box-shadow: 0 0 0 1px var(--cursor-color);
  }

  .excal-arrow {
    display: block;
    filter: drop-shadow(0 1px 1px rgb(0 0 0 / 0.12));
  }

  .excal-name {
    position: absolute;
    top: 16px;
    left: 6px;
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 3px 6px;
    border-radius: 8px;
    background: var(--cursor-color);
    border: 1px solid #ffffff;
    color: #1e1e1e;
    font-size: 12px;
    font-weight: 600;
    line-height: 1.2;
    white-space: nowrap;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.1);
  }
</style>
