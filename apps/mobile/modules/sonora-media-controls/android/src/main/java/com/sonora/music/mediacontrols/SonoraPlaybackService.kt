package com.sonora.music.mediacontrols

import android.app.PendingIntent
import android.content.Intent
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
    val sessionBuilder = MediaSession.Builder(this, player)
      .setMediaButtonPreferences(mediaButtons)
    buildSessionActivityPendingIntent()?.let { sessionBuilder.setSessionActivity(it) }
    mediaSession = sessionBuilder.build()
  }

  /**
   * Builds the PendingIntent used as the notification's content intent so that tapping the
   * media notification brings the app back to the foreground. Resolves the launcher activity
   * from the package manager to avoid a compile-time dependency on the app module.
   */
  private fun buildSessionActivityPendingIntent(): PendingIntent? {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
      ?.apply { addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP) }
      ?: return null
    return PendingIntent.getActivity(
      this,
      /* requestCode = */ 1,
      launchIntent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
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
