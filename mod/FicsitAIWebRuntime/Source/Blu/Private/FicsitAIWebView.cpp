// FicsitAI: Slate-вьюпорт страницы BLUI с вводом мыши и клавиатуры.
#include "FicsitAIWebView.h"
#include "BluEye.h"
#include "IBlu.h"
#include "Engine/Texture2D.h"
#include "Rendering/DrawElements.h"

#if PLATFORM_WINDOWS
#include "Windows/AllowWindowsPlatformTypes.h"
#include <Windows.h>
#include "Windows/HideWindowsPlatformTypes.h"
#endif

namespace
{
	uint32 InputModifiers(const FInputEvent& Event)
	{
		// BLUI проверял модификаторы через else-if и терял сочетания вроде Ctrl+Shift — здесь все флаги вместе.
		uint32 Flags = 0;
		if (Event.IsShiftDown()) { Flags |= EVENTFLAG_SHIFT_DOWN; }
		if (Event.IsControlDown()) { Flags |= EVENTFLAG_CONTROL_DOWN; }
		if (Event.IsAltDown()) { Flags |= EVENTFLAG_ALT_DOWN; }
		if (Event.IsCommandDown()) { Flags |= EVENTFLAG_COMMAND_DOWN; }
		if (Event.AreCapsLocked()) { Flags |= EVENTFLAG_CAPS_LOCK_ON; }
		if (Event.IsRepeat()) { Flags |= EVENTFLAG_IS_REPEAT; }
		return Flags;
	}

	bool ButtonOf(const FKey& Key, cef_mouse_button_type_t& Out, uint32& Flag)
	{
		if (Key == EKeys::LeftMouseButton) { Out = MBT_LEFT; Flag = EVENTFLAG_LEFT_MOUSE_BUTTON; return true; }
		if (Key == EKeys::RightMouseButton) { Out = MBT_RIGHT; Flag = EVENTFLAG_RIGHT_MOUSE_BUTTON; return true; }
		if (Key == EKeys::MiddleMouseButton) { Out = MBT_MIDDLE; Flag = EVENTFLAG_MIDDLE_MOUSE_BUTTON; return true; }
		return false;
	}

	// CEF 128 под Windows ждёт в native_key_code голый скан-код (0xE0xx у расширенных клавиш), из него
	// страница получает event.code. Проверено в игре: с полем lParam WM_KEYDOWN event.code пустой.
	// MapVirtualKeyW под Wine не ставит префикс 0xE0, и стрелки приходили как Numpad4 — расширенные
	// клавиши помечаем сами.
	int NativeKeyCode(uint32 VirtualKey)
	{
		uint32 Scan = 0;
#if PLATFORM_WINDOWS
		Scan = ::MapVirtualKeyW(VirtualKey, MAPVK_VK_TO_VSC_EX);
		if (Scan == 0) { Scan = ::MapVirtualKeyW(VirtualKey, MAPVK_VK_TO_VSC); }
#endif
		switch (VirtualKey)
		{
		case 0x21: case 0x22: case 0x23: case 0x24: // PageUp, PageDown, End, Home
		case 0x25: case 0x26: case 0x27: case 0x28: // стрелки
		case 0x2D: case 0x2E:                       // Insert, Delete
		case 0x5B: case 0x5C: case 0x5D:            // Win, Win, Menu
		case 0x6F:                                  // NumPad /
		case 0xA3: case 0xA5:                       // правые Ctrl и Alt
			if ((Scan & 0xFF00) == 0) { Scan |= 0xE000; }
			break;
		default:
			break;
		}
		return static_cast<int>(Scan);
	}
}

void SFicsitAIWebView::Construct(const FArguments& InArgs)
{
	Eye = InArgs._Eye;
	Brush.DrawAs = ESlateBrushDrawType::Image;
	bFollowPixelSize = InArgs._FollowPixelSize;
	// Желаемый размер не следует за размером страницы: иначе при FollowPixelSize размер виджета зависел бы
	// от размера браузера, а тот — от размера виджета.
	const FIntPoint Size = PageSize();
	DesiredSize = InArgs._DesiredSize.IsNearlyZero() ? FVector2D(Size.X, Size.Y) : InArgs._DesiredSize;
}

void SFicsitAIWebView::Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime)
{
	UBluEye* E = Eye.Get();
	if (!E) { return; }
	E->ReleaseRetiredTextures();
	if (!bFollowPixelSize) { return; }
	// Абсолютный размер геометрии — пиксели окна: в нём уже учтены масштаб интерфейса, DPI и SScaleBox.
	const FVector2D Px = AllottedGeometry.GetAbsoluteSize();
	const FIntPoint Want(FMath::Clamp(FMath::RoundToInt(Px.X), 16, 4096), FMath::Clamp(FMath::RoundToInt(Px.Y), 16, 4096));
	if (Want == PageSize()) { PendingSize = FIntPoint::ZeroValue; return; }
	if (Want != PendingSize) { PendingSize = Want; PendingSince = InCurrentTime; return; }
	if (InCurrentTime - PendingSince >= 0.15)
	{
		UE_LOG(LogBlu, Display, TEXT("FicsitAI: view %dx%d px, browser %dx%d -> %dx%d"),
			Want.X, Want.Y, PageSize().X, PageSize().Y, Want.X, Want.Y);
		PendingSize = FIntPoint::ZeroValue;
		E->ResizeBrowser(Want.X, Want.Y);
	}
}

FIntPoint SFicsitAIWebView::PageSize() const
{
	const UBluEye* E = Eye.Get();
	return E ? FIntPoint(FMath::Max(1, (int32)E->Settings.ViewSize.X), FMath::Max(1, (int32)E->Settings.ViewSize.Y)) : FIntPoint(1, 1);
}

FVector2D SFicsitAIWebView::ComputeDesiredSize(float) const
{
	return DesiredSize;
}

int32 SFicsitAIWebView::OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
	FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const
{
	UBluEye* E = Eye.Get();
	UTexture2D* Texture = E ? E->GetDisplayTexture() : nullptr;
	if (!Texture) { return LayerId; }
	if (Brush.GetResourceObject() != Texture)
	{
		Brush.SetResourceObject(Texture);
	}
	Brush.ImageSize = FVector2D(Texture->GetSizeX(), Texture->GetSizeY());
	// Кадр CEF — premultiplied alpha (как в cefclient: glBlendFunc(GL_ONE, GL_ONE_MINUS_SRC_ALPHA)).
	// У непрозрачной страницы альфа везде 255, и результат тот же, что раньше.
	FSlateDrawElement::MakeBox(OutDrawElements, LayerId, AllottedGeometry.ToPaintGeometry(), &Brush,
		ESlateDrawEffect::PreMultipliedAlpha, InWidgetStyle.GetColorAndOpacityTint());
	return LayerId;
}

bool SFicsitAIWebView::ScreenToPage(const FGeometry& Geometry, const FVector2D& ScreenPos, FIntPoint& OutPage) const
{
	const FVector2D Local = Geometry.AbsoluteToLocal(ScreenPos);
	const FVector2D LocalSize = Geometry.GetLocalSize();
	const FIntPoint Size = PageSize();
	if (LocalSize.X <= 0 || LocalSize.Y <= 0) { return false; }
	OutPage.X = FMath::Clamp(FMath::FloorToInt(Local.X / LocalSize.X * Size.X), 0, Size.X - 1);
	OutPage.Y = FMath::Clamp(FMath::FloorToInt(Local.Y / LocalSize.Y * Size.Y), 0, Size.Y - 1);
	return Local.X >= 0 && Local.Y >= 0 && Local.X < LocalSize.X && Local.Y < LocalSize.Y;
}

FReply SFicsitAIWebView::SendButton(const FGeometry& Geometry, const FPointerEvent& Event, bool bUp, int32 ClickCount)
{
	CefRefPtr<CefBrowserHost> Host = Eye.IsValid() ? Eye->GetBrowserHost() : nullptr;
	cef_mouse_button_type_t Button = MBT_LEFT;
	uint32 Flag = 0;
	if (!Host || !ButtonOf(Event.GetEffectingButton(), Button, Flag)) { return FReply::Unhandled(); }
	ScreenToPage(Geometry, Event.GetScreenSpacePosition(), LastPage);
	if (!bUp) { ButtonFlags |= Flag; }
	CefMouseEvent Mouse;
	Mouse.x = LastPage.X;
	Mouse.y = LastPage.Y;
	Mouse.modifiers = InputModifiers(Event) | ButtonFlags;
	if (bUp) { ButtonFlags &= ~Flag; }
	Host->SendMouseClickEvent(Mouse, Button, bUp, ClickCount);
	if (!bUp)
	{
		LastClickCount = ClickCount;
		return FReply::Handled().CaptureMouse(SharedThis(this)).SetUserFocus(SharedThis(this), EFocusCause::Mouse);
	}
	return ButtonFlags == 0 ? FReply::Handled().ReleaseMouseCapture() : FReply::Handled();
}

FReply SFicsitAIWebView::OnMouseButtonDown(const FGeometry& Geometry, const FPointerEvent& Event)
{
	return SendButton(Geometry, Event, false, 1);
}

FReply SFicsitAIWebView::OnMouseButtonDoubleClick(const FGeometry& Geometry, const FPointerEvent& Event)
{
	// Slate присылает второе нажатие двойного щелчка сюда, а не в OnMouseButtonDown.
	return SendButton(Geometry, Event, false, 2);
}

FReply SFicsitAIWebView::OnMouseButtonUp(const FGeometry& Geometry, const FPointerEvent& Event)
{
	return SendButton(Geometry, Event, true, LastClickCount);
}

FReply SFicsitAIWebView::OnMouseMove(const FGeometry& Geometry, const FPointerEvent& Event)
{
	CefRefPtr<CefBrowserHost> Host = Eye.IsValid() ? Eye->GetBrowserHost() : nullptr;
	if (!Host) { return FReply::Unhandled(); }
	ScreenToPage(Geometry, Event.GetScreenSpacePosition(), LastPage);
	CefMouseEvent Mouse;
	Mouse.x = LastPage.X;
	Mouse.y = LastPage.Y;
	Mouse.modifiers = InputModifiers(Event) | ButtonFlags;
	Host->SendMouseMoveEvent(Mouse, false);
	return FReply::Handled();
}

void SFicsitAIWebView::OnMouseLeave(const FPointerEvent& Event)
{
	CefRefPtr<CefBrowserHost> Host = Eye.IsValid() ? Eye->GetBrowserHost() : nullptr;
	if (!Host || ButtonFlags != 0) { return; }
	CefMouseEvent Mouse;
	Mouse.x = LastPage.X;
	Mouse.y = LastPage.Y;
	Mouse.modifiers = InputModifiers(Event);
	Host->SendMouseMoveEvent(Mouse, true);
}

FReply SFicsitAIWebView::OnMouseWheel(const FGeometry& Geometry, const FPointerEvent& Event)
{
	CefRefPtr<CefBrowserHost> Host = Eye.IsValid() ? Eye->GetBrowserHost() : nullptr;
	if (!Host) { return FReply::Unhandled(); }
	ScreenToPage(Geometry, Event.GetScreenSpacePosition(), LastPage);
	CefMouseEvent Mouse;
	Mouse.x = LastPage.X;
	Mouse.y = LastPage.Y;
	Mouse.modifiers = InputModifiers(Event) | ButtonFlags;
	// Один щелчок колеса в Slate — 1.0; в Windows — WHEEL_DELTA = 120. BLUI слал 10 и по обеим осям сразу.
	Host->SendMouseWheelEvent(Mouse, 0, FMath::RoundToInt(Event.GetWheelDelta() * 120.f));
	return FReply::Handled();
}

void SFicsitAIWebView::OnMouseCaptureLost(const FCaptureLostEvent& CaptureLostEvent)
{
	if (CefRefPtr<CefBrowserHost> Host = Eye.IsValid() ? Eye->GetBrowserHost() : nullptr)
	{
		Host->SendCaptureLostEvent();
	}
	ButtonFlags = 0;
}

namespace
{
	// В Windows код клавиши приходит всегда; если его нет (событие собрано вручную), у букв и цифр
	// код виртуальной клавиши совпадает с заглавным символом.
	int32 VirtualKeyOf(const FKeyEvent& Event)
	{
		if (Event.GetKeyCode() != 0) { return static_cast<int32>(Event.GetKeyCode()); }
		const uint32 Ch = FChar::ToUpper(static_cast<TCHAR>(Event.GetCharacter()));
		return ((Ch >= 'A' && Ch <= 'Z') || (Ch >= '0' && Ch <= '9')) ? static_cast<int32>(Ch) : 0;
	}
}

FReply SFicsitAIWebView::OnKeyDown(const FGeometry& Geometry, const FKeyEvent& Event)
{
	CefRefPtr<CefBrowserHost> Host = Eye.IsValid() ? Eye->GetBrowserHost() : nullptr;
	const int32 Vk = VirtualKeyOf(Event);
	if (!Host || Vk == 0) { return FReply::Unhandled(); }
	CefKeyEvent Key;
	Key.type = KEYEVENT_RAWKEYDOWN;
	Key.windows_key_code = Vk;
	Key.native_key_code = NativeKeyCode(Vk);
	Key.modifiers = InputModifiers(Event);
	Key.is_system_key = Event.IsAltDown() && !Event.IsControlDown();
	Host->SendKeyEvent(Key);
	PressedKeys.Add(Vk);
	return FReply::Handled();
}

FReply SFicsitAIWebView::OnKeyUp(const FGeometry& Geometry, const FKeyEvent& Event)
{
	CefRefPtr<CefBrowserHost> Host = Eye.IsValid() ? Eye->GetBrowserHost() : nullptr;
	const int32 Vk = VirtualKeyOf(Event);
	if (!Host || Vk == 0) { return FReply::Unhandled(); }
	CefKeyEvent Key;
	Key.type = KEYEVENT_KEYUP;
	Key.windows_key_code = Vk;
	Key.native_key_code = NativeKeyCode(Vk);
	Key.modifiers = InputModifiers(Event);
	Key.is_system_key = Event.IsAltDown() && !Event.IsControlDown();
	Host->SendKeyEvent(Key);
	PressedKeys.Remove(Vk);
	return FReply::Handled();
}

FReply SFicsitAIWebView::OnKeyChar(const FGeometry& Geometry, const FCharacterEvent& Event)
{
	CefRefPtr<CefBrowserHost> Host = Eye.IsValid() ? Eye->GetBrowserHost() : nullptr;
	if (!Host) { return FReply::Unhandled(); }
	const TCHAR Ch = Event.GetCharacter();
	CefKeyEvent Key;
	Key.type = KEYEVENT_CHAR;
	Key.windows_key_code = static_cast<int>(Ch);
	Key.character = static_cast<char16_t>(Ch);
	Key.unmodified_character = static_cast<char16_t>(Ch);
	Key.modifiers = InputModifiers(Event);
	Host->SendKeyEvent(Key);
	return FReply::Handled();
}

FReply SFicsitAIWebView::OnFocusReceived(const FGeometry& Geometry, const FFocusEvent& Event)
{
	if (CefRefPtr<CefBrowserHost> Host = Eye.IsValid() ? Eye->GetBrowserHost() : nullptr)
	{
		Host->SetFocus(true);
	}
	return FReply::Handled();
}

void SFicsitAIWebView::OnFocusLost(const FFocusEvent& Event)
{
	ReleaseAll();
}

void SFicsitAIWebView::ReleaseAll()
{
	CefRefPtr<CefBrowserHost> Host = Eye.IsValid() ? Eye->GetBrowserHost() : nullptr;
	if (Host)
	{
		// Клавиша, нажатая в странице и отпущенная уже в игре, иначе осталась бы в странице нажатой.
		for (const int32 Vk : PressedKeys)
		{
			CefKeyEvent Key;
			Key.type = KEYEVENT_KEYUP;
			Key.windows_key_code = Vk;
			Key.native_key_code = NativeKeyCode(Vk);
			Host->SendKeyEvent(Key);
		}
		CefMouseEvent Mouse;
		Mouse.x = LastPage.X;
		Mouse.y = LastPage.Y;
		const struct { uint32 Flag; cef_mouse_button_type_t Button; } Buttons[] = {
			{ EVENTFLAG_LEFT_MOUSE_BUTTON, MBT_LEFT }, { EVENTFLAG_RIGHT_MOUSE_BUTTON, MBT_RIGHT }, { EVENTFLAG_MIDDLE_MOUSE_BUTTON, MBT_MIDDLE } };
		for (const auto& B : Buttons)
		{
			if (ButtonFlags & B.Flag) { Host->SendMouseClickEvent(Mouse, B.Button, true, 1); }
		}
		Host->SendMouseMoveEvent(Mouse, true);
		Host->SetFocus(false);
	}
	PressedKeys.Reset();
	ButtonFlags = 0;
}

FCursorReply SFicsitAIWebView::OnCursorQuery(const FGeometry& Geometry, const FPointerEvent& Event) const
{
	const UBluEye* E = Eye.Get();
	switch (E ? E->GetCursorType() : CT_POINTER)
	{
	case CT_HAND: return FCursorReply::Cursor(EMouseCursor::Hand);
	case CT_IBEAM: case CT_VERTICALTEXT: return FCursorReply::Cursor(EMouseCursor::TextEditBeam);
	case CT_CROSS: case CT_CELL: return FCursorReply::Cursor(EMouseCursor::Crosshairs);
	case CT_EASTRESIZE: case CT_WESTRESIZE: case CT_EASTWESTRESIZE: case CT_COLUMNRESIZE: return FCursorReply::Cursor(EMouseCursor::ResizeLeftRight);
	case CT_NORTHRESIZE: case CT_SOUTHRESIZE: case CT_NORTHSOUTHRESIZE: case CT_ROWRESIZE: return FCursorReply::Cursor(EMouseCursor::ResizeUpDown);
	case CT_NORTHEASTRESIZE: case CT_SOUTHWESTRESIZE: case CT_NORTHEASTSOUTHWESTRESIZE: return FCursorReply::Cursor(EMouseCursor::ResizeSouthWest);
	case CT_NORTHWESTRESIZE: case CT_SOUTHEASTRESIZE: case CT_NORTHWESTSOUTHEASTRESIZE: return FCursorReply::Cursor(EMouseCursor::ResizeSouthEast);
	case CT_MOVE: return FCursorReply::Cursor(EMouseCursor::CardinalCross);
	case CT_NOTALLOWED: case CT_NODROP: return FCursorReply::Cursor(EMouseCursor::SlashedCircle);
	case CT_GRAB: return FCursorReply::Cursor(EMouseCursor::GrabHand);
	case CT_GRABBING: return FCursorReply::Cursor(EMouseCursor::GrabHandClosed);
	case CT_NONE: return FCursorReply::Cursor(EMouseCursor::None);
	default: return FCursorReply::Cursor(EMouseCursor::Default);
	}
}
