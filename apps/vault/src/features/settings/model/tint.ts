export function vibrantTint([red, green, blue]: number[]) {
  if (blue > 175 && blue - green > 40 && green - red > 25) {
    return "#58c7ff";
  }
  const channels = [red, green, blue].map((channel) =>
    Math.round(channel + (255 - channel) * 0.12)
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${channels.join("")}`;
}

export function tintChannels(color: string) {
  return /^#[\da-f]{6}$/i.test(color)
    ? [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16))
    : null;
}
