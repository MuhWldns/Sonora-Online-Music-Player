package com.sonora.music.mediacontrols

import android.content.ComponentName
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class SonoraTrackRecord : Record {
  @Field lateinit var id: String
  @Field lateinit var url: String
  @Field lateinit var title: String
  @Field lateinit var artist: String
  @Field var artwork: String? = null
}

class SonoraMediaControlsModule : Module() {
  private var controller: MediaController? = null
  private var controllerFuture: com.google.common.util.concurrent.ListenableFuture<MediaController>? = null
  private val handler = Handler(Looper.getMainLooper())

  private val progressUpdate = object : Runnable {
    override fun run() {
      sendStatus()
      if (controller?.isPlaying == true) handler.postDelayed(this, 500)
    }
  }

  private val playerListener = object : Player.Listener {
    override fun onEvents(player: Player, events: Player.Events) {
      sendStatus()
      if (player.isPlaying) startProgressUpdates() else handler.removeCallbacks(progressUpdate)
    }

    override fun onPlayerError(error: PlaybackException) {
      sendStatus(error.message ?: "Playback error")
    }
  }

  override fun definition() = ModuleDefinition {
    Name("SonoraMediaControls")
    Events("statusChanged")

    AsyncFunction("setup") { promise: Promise ->
      setupController(promise)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("replaceQueue") { tracks: List<SonoraTrackRecord>, startIndex: Int ->
      requireController().apply {
        stop()
        clearMediaItems()
        setMediaItems(tracks.map(::mediaItem), startIndex.coerceIn(0, tracks.lastIndex), 0L)
        prepare()
        play()
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("appendTracks") { tracks: List<SonoraTrackRecord> ->
      requireController().addMediaItems(tracks.map(::mediaItem))
    }.runOnQueue(Queues.MAIN)

    /** Insert at a queue position: currentIndex+1 = "play next", count = "add to end". */
    AsyncFunction("insertTracks") { tracks: List<SonoraTrackRecord>, index: Int ->
      requireController().apply {
        addMediaItems(index.coerceIn(0, mediaItemCount), tracks.map(::mediaItem))
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("setShuffle") { enabled: Boolean ->
      requireController().shuffleModeEnabled = enabled
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("play") { requireController().play() }.runOnQueue(Queues.MAIN)
    AsyncFunction("pause") { requireController().pause() }.runOnQueue(Queues.MAIN)
    AsyncFunction("next") { requireController().seekToNextMediaItem() }.runOnQueue(Queues.MAIN)
    AsyncFunction("previous") {
      requireController().apply {
        if (currentPosition > 3_000L) seekTo(0L) else seekToPreviousMediaItem()
      }
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("skipTo") { index: Int ->
      requireController().seekToDefaultPosition(index)
      requireController().play()
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("seekTo") { seconds: Double ->
      requireController().seekTo((seconds * 1_000).toLong().coerceAtLeast(0L))
    }.runOnQueue(Queues.MAIN)

    OnDestroy {
      handler.removeCallbacks(progressUpdate)
      controller?.removeListener(playerListener)
      controller?.release()
      controllerFuture?.cancel(true)
      controller = null
      controllerFuture = null
    }
  }

  private fun setupController(promise: Promise) {
    controller?.let {
      promise.resolve()
      return
    }

    val context = appContext.reactContext ?: run {
      promise.reject("ERR_NO_CONTEXT", "React context is unavailable", null)
      return
    }
    val token = SessionToken(context, ComponentName(context, SonoraPlaybackService::class.java))
    val future = MediaController.Builder(context, token).buildAsync()
    controllerFuture = future
    future.addListener({
      try {
        controller = future.get().also { it.addListener(playerListener) }
        sendStatus()
        promise.resolve()
      } catch (error: Exception) {
        promise.reject("ERR_MEDIA_CONTROLLER", error.message, error)
      }
    }, ContextCompat.getMainExecutor(context))
  }

  private fun requireController(): MediaController =
    controller ?: error("Sonora media controls have not been set up")

  private fun mediaItem(track: SonoraTrackRecord): MediaItem {
    val metadata = MediaMetadata.Builder()
      .setTitle(track.title)
      .setArtist(track.artist)
      .apply { track.artwork?.let { setArtworkUri(Uri.parse(it)) } }
      .build()
    return MediaItem.Builder()
      .setMediaId(track.id)
      .setUri(track.url)
      .setMediaMetadata(metadata)
      .build()
  }

  private fun startProgressUpdates() {
    handler.removeCallbacks(progressUpdate)
    handler.post(progressUpdate)
  }

  private fun sendStatus(error: String? = null) {
    val player = controller ?: return
    val duration = player.duration.takeUnless { it == C.TIME_UNSET } ?: 0L
    sendEvent(
      "statusChanged",
      mapOf(
        "index" to player.currentMediaItemIndex,
        "playing" to player.isPlaying,
        "buffering" to (player.playbackState == Player.STATE_BUFFERING),
        "currentTime" to player.currentPosition.coerceAtLeast(0L) / 1_000.0,
        "duration" to duration.coerceAtLeast(0L) / 1_000.0,
        "shuffle" to player.shuffleModeEnabled,
        "error" to error
      )
    )
  }
}
