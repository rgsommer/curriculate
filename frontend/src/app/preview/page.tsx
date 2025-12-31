export default function PreviewPage() {
  return (
    <main className="preview-root">
      {/* Static classroom stage */}
      <img
        src="/preview/stage.jpg"
        alt="Curriculate classroom preview stage"
        className="preview-stage"
      />

      {/* Station overlays */}
      <video className="station s1" src="/preview/station-01-scan.mp4" autoPlay loop muted playsInline />
      <video className="station s2" src="/preview/station-02-mcq.mp4" autoPlay loop muted playsInline />
      <video className="station s3" src="/preview/station-03-make-snap.mp4" autoPlay loop muted playsInline />
      <video className="station s4" src="/preview/station-04-maddash.mp4" autoPlay loop muted playsInline />
      <video className="station s5" src="/preview/station-05-word-brain.mp4" autoPlay loop muted playsInline />
      <video className="station s6" src="/preview/station-06-venn-sort.mp4" autoPlay loop muted playsInline />
      <video className="station s7" src="/preview/station-07-physical-choice.mp4" autoPlay loop muted playsInline />
      <video className="station s8" src="/preview/station-08-feedback.mp4" autoPlay loop muted playsInline />
    </main>
  );
}
