package com.sonora.music.mediacontrols

import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.CommandButton
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

@OptIn(UnstableApi::class)
class SonoraPlaybackService : MediaSessionService() {
  private var mediaSession: MediaSession? = null

  override fun onCreate() {
    super.onCreate()
    val player = ExoPlayer.Builder(this)
      .setAudioAttributes(AudioAttributes.DEFAULT, true)
      .setHandleAudioBecomingNoisy(true)
      .build()
    val mediaButtons = listOf(
      CommandButton.Builder(CommandButton.ICON_PREVIOUS)
        .setPlayerCommand(Player.COMMAND_SEEK_TO_PREVIOUS)
        .setDisplayName("Previous")
        .setSlots(CommandButton.SLOT_BACK)
        .build(),
      CommandButton.Builder(CommandButton.ICON_NEXT)
        .setPlayerCommand(Player.COMMAND_SEEK_TO_NEXT)
        .setDisplayName("Next")
        .setSlots(CommandButton.SLOT_FORWARD)
        .build(),
    )
    mediaSession = MediaSession.Builder(this, player)
      .setMediaButtonPreferences(mediaButtons)
      .build()
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = mediaSession

  override fun onDestroy() {
    mediaSession?.run {
      player.release()
      release()
    }
    mediaSession = null
    super.onDestroy()
  }
}
