package com.meridian.tradeos.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.meridian.tradeos.ui.theme.AccentGlow
import com.meridian.tradeos.ui.theme.GlassBorder
import com.meridian.tradeos.ui.theme.GlassBorderSubtle

/**
 * Glassmorphism surface: translucent gradient fill + frosted border + soft shadow.
 *
 * On API 31+ you can add true backdrop blur via a custom RenderEffect node behind this
 * composable if needed; this implementation achieves the visual language without blur,
 * which looks great on the deep dark mesh backgrounds used throughout Meridian.
 */
@Composable
fun GlassCard(
    modifier: Modifier = Modifier,
    cornerRadius: Dp = 24.dp,
    glowAccent: Boolean = false,
    content: @Composable BoxScope.() -> Unit,
) {
    val shape = RoundedCornerShape(cornerRadius)

    val borderBrush = if (glowAccent) {
        Brush.verticalGradient(listOf(AccentGlow, GlassBorderSubtle))
    } else {
        Brush.verticalGradient(listOf(GlassBorder, GlassBorderSubtle))
    }

    Box(
        modifier = modifier
            .shadow(
                elevation = 16.dp,
                shape = shape,
                ambientColor = Color.Black.copy(alpha = 0.6f),
                spotColor = Color.Black.copy(alpha = 0.4f),
            )
            .clip(shape)
            .background(
                brush = Brush.verticalGradient(
                    colors = listOf(
                        Color.White.copy(alpha = 0.10f),
                        Color.White.copy(alpha = 0.04f),
                    )
                )
            )
            .border(width = 1.dp, brush = borderBrush, shape = shape),
        content = content,
    )
}
