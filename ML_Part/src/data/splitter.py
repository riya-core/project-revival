from sklearn.model_selection import train_test_split


def stratified_split(
    df,
    target_column="dx",
    test_size=0.15,
    validation_size=0.15,
    random_state=42
):
    """
    Perform stratified train/validation/test split.

    Final proportions:
        Train: 70%
        Validation: 15%
        Test: 15%
    """

    train_df, temp_df = train_test_split(
        df,
        test_size=test_size + validation_size,
        stratify=df[target_column],
        random_state=random_state
    )

    relative_test_size = (
        test_size /
        (test_size + validation_size)
    )

    val_df, test_df = train_test_split(
        temp_df,
        test_size=relative_test_size,
        stratify=temp_df[target_column],
        random_state=random_state
    )

    return train_df, val_df, test_df