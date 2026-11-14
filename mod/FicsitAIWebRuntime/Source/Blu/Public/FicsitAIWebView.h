// FicsitAI: Slate-вьюпорт страницы BLUI с вводом мыши и клавиатуры.
#pragma once

#include "CoreMinimal.h"
#include "Widgets/SLeafWidget.h"
#include "Styling/SlateBrush.h"

class UBluEye;

/**
 * Рисует текстуру браузера на всю свою геометрию и переводит ввод Slate в события CEF.
 * Координаты мыши пересчитываются из локальной геометрии виджета в пиксели страницы, поэтому
 * виджет можно растягивать и масштабировать DPI — попадание в элементы DOM сохраняется.
 * Клавиши с кодами Windows и скан-кодами (у страницы есть и event.key, и event.code), символы — отдельно.
 * Сам экран не открывает и не закрывает: этим занимается владелец (режим ввода, горячая клавиша).
 *
 * Размер браузера (FollowPixelSize): страница рисуется ровно в пиксельный размер виджета на экране, а не в единицы
 * Slate, которые масштаб интерфейса растягивает или сжимает. Смена размера — когда размер виджета не менялся 0,15 с,
 * чтобы перетаскивание окна не пересоздавало браузерную текстуру на каждый кадр.
 *
 * Прозрачность: кадр CEF приходит с premultiplied alpha и так и смешивается, поэтому прозрачная страница поверх игры
 * (HUD) не даёт тёмной каймы. Пропускать ли ввод в игру, решает владелец: HUD ставит виджету HitTestInvisible
 * и не даёт ему фокус.
 */
class BLU_API SFicsitAIWebView : public SLeafWidget
{
public:
	SLATE_BEGIN_ARGS(SFicsitAIWebView) : _FollowPixelSize(false), _DesiredSize(FVector2D::ZeroVector) {}
		SLATE_ARGUMENT(UBluEye*, Eye)
		/** Менять размер браузера по пиксельному размеру виджета. */
		SLATE_ARGUMENT(bool, FollowPixelSize)
		/** Желаемый размер в единицах Slate; ноль — размер страницы при создании виджета. */
		SLATE_ARGUMENT(FVector2D, DesiredSize)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

	/** Отпустить в странице всё нажатое (клавиши и кнопки мыши) и снять фокус. Вызывать при закрытии экрана. */
	void ReleaseAll();

	void SetFollowPixelSize(bool bFollow) { bFollowPixelSize = bFollow; PendingSize = FIntPoint::ZeroValue; }
	bool IsFollowingPixelSize() const { return bFollowPixelSize; }

	/** Пиксель страницы для точки экрана; false — точка вне виджета. Для проверок и отладки. */
	bool ScreenToPage(const FGeometry& Geometry, const FVector2D& ScreenPos, FIntPoint& OutPage) const;

	// SWidget
	virtual int32 OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
		FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const override;
	virtual FVector2D ComputeDesiredSize(float) const override;
	virtual void Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime) override;
	virtual bool SupportsKeyboardFocus() const override { return true; }
	virtual FReply OnMouseButtonDown(const FGeometry& Geometry, const FPointerEvent& Event) override;
	virtual FReply OnMouseButtonUp(const FGeometry& Geometry, const FPointerEvent& Event) override;
	virtual FReply OnMouseButtonDoubleClick(const FGeometry& Geometry, const FPointerEvent& Event) override;
	virtual FReply OnMouseMove(const FGeometry& Geometry, const FPointerEvent& Event) override;
	virtual void OnMouseLeave(const FPointerEvent& Event) override;
	virtual FReply OnMouseWheel(const FGeometry& Geometry, const FPointerEvent& Event) override;
	virtual void OnMouseCaptureLost(const FCaptureLostEvent& CaptureLostEvent) override;
	virtual FReply OnKeyDown(const FGeometry& Geometry, const FKeyEvent& Event) override;
	virtual FReply OnKeyUp(const FGeometry& Geometry, const FKeyEvent& Event) override;
	virtual FReply OnKeyChar(const FGeometry& Geometry, const FCharacterEvent& Event) override;
	virtual FReply OnFocusReceived(const FGeometry& Geometry, const FFocusEvent& Event) override;
	virtual void OnFocusLost(const FFocusEvent& Event) override;
	virtual FCursorReply OnCursorQuery(const FGeometry& Geometry, const FPointerEvent& Event) const override;

private:
	TWeakObjectPtr<UBluEye> Eye;
	mutable FSlateBrush Brush;
	uint32 ButtonFlags = 0;
	int32 LastClickCount = 1;
	FIntPoint LastPage = FIntPoint(0, 0);
	TSet<int32> PressedKeys;
	bool bFollowPixelSize = false;
	FVector2D DesiredSize = FVector2D::ZeroVector;
	FIntPoint PendingSize = FIntPoint::ZeroValue;
	double PendingSince = 0.0;

	FReply SendButton(const FGeometry& Geometry, const FPointerEvent& Event, bool bUp, int32 ClickCount);
	FIntPoint PageSize() const;
};
