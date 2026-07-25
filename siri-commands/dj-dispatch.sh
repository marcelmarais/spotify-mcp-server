#!/bin/bash
# DJ voice-command dispatcher: interprets free text (Portuguese/English) and
# routes it to the right MCP tool. Exits 1 when nothing matches so the caller
# (search-and-play.sh) can fall back to a regular music search.

DIR="$(cd "$(dirname "$0")" && pwd)"
CONTROL="$DIR/../spotify-control.sh"

RAW="$1"
[ -z "$RAW" ] && exit 1

# lowercase + strip accents so matching works for spoken Portuguese
TEXT=$(printf '%s' "$RAW" | tr '[:upper:]' '[:lower:]' | sed 'y/áàâãäéèêëíìîïóòôõöúùûüç/aaaaaeeeeiiiiooooouuuuc/')

ensure_spotify() {
  if ! pgrep -x "Spotify" > /dev/null; then
    open -a Spotify
    sleep 4
  fi
}

play_mood() {
  ensure_spotify
  RESULT=$("$CONTROL" playMood "{\"mood\":\"$1\"}")
  NAME=$(printf '%s' "$RESULT" | sed -n 's/.*Playing "\([^"]*\)".*/\1/p')
  if [ -n "$NAME" ]; then
    echo "Tocando a playlist $NAME"
  else
    echo "$RESULT"
  fi
  exit 0
}

case "$TEXT" in
  *surpreenda*|*surpresa*|*surprise*|*aleatori*)
    MOODS=(happy energetic chill focused romantic nostalgic party workout)
    play_mood "${MOODS[$((RANDOM % ${#MOODS[@]}))]}"
    ;;
  *pausa*|*pause*|*pare\ *|pare|*stop*)
    "$CONTROL" pausePlayback > /dev/null
    echo "Pausado"
    exit 0
    ;;
  *continuar*|*continue*|*retomar*|*resume*|*despausa*|*volta\ a\ tocar*)
    "$CONTROL" resumePlayback > /dev/null
    echo "Voltando a tocar"
    exit 0
    ;;
  *proxima*|*proximo*|*pular*|*pula*|*avanca*|*next*|*skip*)
    "$CONTROL" skipToNext > /dev/null
    echo "Pulando para a proxima"
    exit 0
    ;;
  *anterior*|*previous*)
    "$CONTROL" skipToPrevious > /dev/null
    echo "Voltando uma faixa"
    exit 0
    ;;
  *tocando*|*now\ playing*|*que\ musica*)
    RESULT=$("$CONTROL" getNowPlaying)
    TRACK=$(printf '%s' "$RESULT" | sed -n 's/\*\*Track\*\*: "\(.*\)"/\1/p')
    ARTIST=$(printf '%s' "$RESULT" | sed -n 's/\*\*Artist\*\*: \(.*\)/\1/p')
    if [ -n "$TRACK" ]; then
      echo "Tocando $TRACK de $ARTIST"
    else
      echo "Nada tocando no momento"
    fi
    exit 0
    ;;
  *curtir*|*curte*|*gostei*|*amei*|*favorit*|*like*)
    RESULT=$("$CONTROL" likeCurrentTrack)
    LIKED=$(printf '%s' "$RESULT" | sed -n 's/.*liked "\([^"]*\)" by \(.*\)/\1 de \2/p')
    if [ -n "$LIKED" ]; then
      echo "Curti $LIKED"
    else
      echo "Curtida salva"
    fi
    exit 0
    ;;
  *feliz*|*alegre*|*happy*) play_mood happy ;;
  *triste*|*sad*) play_mood sad ;;
  *energi*|*animad*|*agitad*) play_mood energetic ;;
  *calm*|*relax*|*tranquil*|*chill*|*suave*) play_mood chill ;;
  *foco*|*focad*|*concentr*|*estud*|*focus*) play_mood focused ;;
  *romantic*|*amor*) play_mood romantic ;;
  *nostalg*|*antigas*|*throwback*) play_mood nostalgic ;;
  *festa*|*balada*|*party*) play_mood party ;;
  *trein*|*academia*|*malha*|*corrida*|*workout*|*gym*) play_mood workout ;;
  *sono*|*dormir*|*sleep*|*ninar*) play_mood sleepy ;;
esac

# No match: let the caller fall back to a music search
exit 1
