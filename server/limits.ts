export function mediaLimits() {
  const free = process.env.CLOUD_PROFILE === "render-free";
  return {
    image_mb: free ? 10 : 25,
    image_pixels: free ? 20_000_000 : 80_000_000,
    video_mb: free ? 25 : 150,
    video_minutes: free ? 5 : 30,
    audio_mb: free ? 10 : 20,
    audio_minutes: free ? 5 : 10,
    upload_concurrency: free ? 1 : 3,
  };
}
export function hostingInfo() {
  const free = process.env.CLOUD_PROFILE === "render-free";
  return {
    profile: free ? "render-free" : "standard",
    may_sleep: free,
    notice: free
      ? "האירוח החינמי עשוי להירדם לאחר חוסר פעילות. התור נשמר בענן, אך העיבוד עשוי להיעצר עד שהשרת יתעורר. המחשב האישי אינו נדרש לפעולה."
      : null,
  };
}
