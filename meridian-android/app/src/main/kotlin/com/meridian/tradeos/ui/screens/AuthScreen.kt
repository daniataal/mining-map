package com.meridian.tradeos.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.meridian.tradeos.data.AuthStorage
import com.meridian.tradeos.data.MeridianRepository
import com.meridian.tradeos.ui.theme.AccentCyan
import com.meridian.tradeos.ui.theme.AccentCyanDim
import com.meridian.tradeos.ui.theme.BackgroundDeep
import com.meridian.tradeos.ui.theme.GlassBorderSubtle
import com.meridian.tradeos.ui.theme.TextMuted
import com.meridian.tradeos.ui.theme.TextPrimary
import kotlinx.coroutines.launch

@Composable
fun AuthScreen(onSignedIn: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val repo = remember { MeridianRepository(context) }
    val auth = remember { AuthStorage(context) }

    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(BackgroundDeep)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 48.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = "Meridian Trade OS",
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
            color = TextPrimary,
        )
        Text(
            text = "Sign in with your mining-viz credentials",
            fontSize = 13.sp,
            color = TextMuted,
            modifier = Modifier.padding(top = 8.dp, bottom = 28.dp),
        )

        OutlinedTextField(
            value = username,
            onValueChange = { username = it; error = null },
            label = { Text("Username", color = TextMuted) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
            colors = OutlinedTextFieldDefaults.colors(
                focusedTextColor = TextPrimary,
                unfocusedTextColor = TextPrimary,
                focusedBorderColor = AccentCyan,
                unfocusedBorderColor = GlassBorderSubtle,
            ),
        )
        Spacer(modifier = Modifier.height(12.dp))
        OutlinedTextField(
            value = password,
            onValueChange = { password = it; error = null },
            label = { Text("Password", color = TextMuted) },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth(),
            colors = OutlinedTextFieldDefaults.colors(
                focusedTextColor = TextPrimary,
                unfocusedTextColor = TextPrimary,
                focusedBorderColor = AccentCyan,
                unfocusedBorderColor = GlassBorderSubtle,
            ),
        )

        error?.let { msg ->
            Text(
                text = msg,
                color = MaterialTheme.colorScheme.error,
                fontSize = 13.sp,
                modifier = Modifier.padding(top = 12.dp),
            )
        }

        Spacer(modifier = Modifier.height(24.dp))

        Button(
            onClick = {
                if (username.isBlank() || password.isBlank()) {
                    error = "Enter username and password"
                    return@Button
                }
                busy = true
                error = null
                scope.launch {
                    repo.login(username.trim(), password).fold(
                        onSuccess = { res ->
                            auth.saveSession(res.accessToken, res.username, res.role, res.id)
                            busy = false
                            onSignedIn()
                        },
                        onFailure = { e ->
                            busy = false
                            error = e.message ?: "Sign-in failed"
                        },
                    )
                }
            },
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(
                containerColor = AccentCyanDim,
                contentColor = TextPrimary,
            ),
        ) {
            Text(if (busy) "Signing in…" else "Sign in", fontWeight = FontWeight.SemiBold)
        }

        TextButton(
            onClick = {
                if (username.isBlank() || password.isBlank()) {
                    error = "Enter username and password to register"
                    return@TextButton
                }
                busy = true
                error = null
                scope.launch {
                    val reg = repo.register(username.trim(), password)
                    if (reg.isFailure) {
                        busy = false
                        error = reg.exceptionOrNull()?.message ?: "Registration failed"
                        return@launch
                    }
                    repo.login(username.trim(), password).fold(
                        onSuccess = { res ->
                            auth.saveSession(res.accessToken, res.username, res.role, res.id)
                            busy = false
                            onSignedIn()
                        },
                        onFailure = { e ->
                            busy = false
                            error = "Account created. Sign in manually: ${e.message}"
                        },
                    )
                }
            },
            enabled = !busy,
            modifier = Modifier.padding(top = 8.dp),
        ) {
            Text("Create account", color = AccentCyan, fontSize = 14.sp)
        }
    }
}
