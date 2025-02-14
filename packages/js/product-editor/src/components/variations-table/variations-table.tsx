/**
 * External dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import {
	Button,
	CheckboxControl,
	Notice,
	Spinner,
	Tooltip,
} from '@wordpress/components';
import {
	EXPERIMENTAL_PRODUCT_VARIATIONS_STORE_NAME,
	ProductVariation,
} from '@woocommerce/data';
import { recordEvent } from '@woocommerce/tracks';
import {
	ListItem,
	Sortable,
	Tag,
	PaginationPageSizePicker,
	PaginationPageArrowsWithPicker,
	usePagination,
} from '@woocommerce/components';
import {
	useContext,
	useState,
	createElement,
	useRef,
	useMemo,
	Fragment,
	forwardRef,
} from '@wordpress/element';
import { useSelect, useDispatch } from '@wordpress/data';
import classnames from 'classnames';
import truncate from 'lodash/truncate';
import { CurrencyContext } from '@woocommerce/currency';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore No types for this exist yet.
// eslint-disable-next-line @woocommerce/dependency-group
import { useEntityId } from '@wordpress/core-data';

/**
 * Internal dependencies
 */
import { getProductStockStatus, getProductStockStatusClass } from '../../utils';
import {
	DEFAULT_VARIATION_PER_PAGE_OPTION,
	PRODUCT_VARIATION_TITLE_LIMIT,
	TRACKS_SOURCE,
} from '../../constants';
import { VariationActionsMenu } from './variation-actions-menu';
import { useSelection } from '../../hooks/use-selection';
import { VariationsActionsMenu } from './variations-actions-menu';
import HiddenWithHelpIcon from '../../icons/hidden-with-help-icon';

const NOT_VISIBLE_TEXT = __( 'Not visible to customers', 'woocommerce' );

type VariationsTableProps = {
	noticeText?: string;
	noticeStatus?: 'error' | 'warning' | 'success' | 'info';
	onNoticeDismiss?: () => void;
	noticeActions?: {
		label: string;
		onClick: (
			handleUpdateAll: ( update: Partial< ProductVariation >[] ) => void,
			handleDeleteAll: ( update: Partial< ProductVariation >[] ) => void
		) => void;
		className?: string;
		variant?: string;
	}[];
	onVariationTableChange?: (
		type: 'update' | 'delete',
		updates?: Partial< ProductVariation >[]
	) => void;
};

export const VariationsTable = forwardRef<
	HTMLDivElement,
	VariationsTableProps
>( function Table(
	{
		noticeText,
		noticeActions = [],
		noticeStatus = 'error',
		onNoticeDismiss = () => {},
		onVariationTableChange = () => {},
	}: VariationsTableProps,
	ref
) {
	const [ currentPage, setCurrentPage ] = useState( 1 );
	const lastVariations = useRef< ProductVariation[] | null >( null );
	const [ perPage, setPerPage ] = useState(
		DEFAULT_VARIATION_PER_PAGE_OPTION
	);
	const [ isUpdating, setIsUpdating ] = useState< Record< string, boolean > >(
		{}
	);
	const {
		areAllSelected,
		isSelected,
		hasSelection,
		onSelectAll,
		onSelectItem,
		onClearSelection,
	} = useSelection();

	const productId = useEntityId( 'postType', 'product' );
	const requestParams = useMemo(
		() => ( {
			product_id: productId,
			page: currentPage,
			per_page: perPage,
			order: 'asc',
			orderby: 'menu_order',
		} ),
		[ productId, currentPage, perPage ]
	);

	const context = useContext( CurrencyContext );
	const { formatAmount } = context;
	const { isLoading, latestVariations, isGeneratingVariations } = useSelect(
		( select ) => {
			const {
				getProductVariations,
				hasFinishedResolution,
				isGeneratingVariations: getIsGeneratingVariations,
			} = select( EXPERIMENTAL_PRODUCT_VARIATIONS_STORE_NAME );
			return {
				isLoading: ! hasFinishedResolution( 'getProductVariations', [
					requestParams,
				] ),
				isGeneratingVariations: getIsGeneratingVariations( {
					product_id: requestParams.product_id,
				} ),
				latestVariations:
					getProductVariations< ProductVariation[] >( requestParams ),
			};
		},
		[ currentPage, perPage, productId ]
	);

	const { totalCount } = useSelect(
		( select ) => {
			const { getProductVariationsTotalCount } = select(
				EXPERIMENTAL_PRODUCT_VARIATIONS_STORE_NAME
			);

			return {
				totalCount:
					getProductVariationsTotalCount< number >( requestParams ),
			};
		},
		[ productId ]
	);

	const paginationProps = usePagination( {
		totalCount,
		defaultPerPage: DEFAULT_VARIATION_PER_PAGE_OPTION,
		onPageChange: setCurrentPage,
		onPerPageChange: setPerPage,
	} );

	const {
		updateProductVariation,
		deleteProductVariation,
		batchUpdateProductVariations,
		invalidateResolution,
	} = useDispatch( EXPERIMENTAL_PRODUCT_VARIATIONS_STORE_NAME );

	const { createSuccessNotice, createErrorNotice } =
		useDispatch( 'core/notices' );

	if ( latestVariations && latestVariations !== lastVariations.current ) {
		lastVariations.current = latestVariations;
	}

	if ( isLoading && lastVariations.current === null ) {
		return (
			<div className="woocommerce-product-variations__loading">
				<Spinner />
				{ isGeneratingVariations && (
					<span>
						{ __( 'Generating variations…', 'woocommerce' ) }
					</span>
				) }
			</div>
		);
	}
	// this prevents a weird jump from happening while changing pages.
	const variations = latestVariations || lastVariations.current;

	const variationIds = variations.map( ( { id } ) => id );

	function handleDeleteVariationClick( variationId: number ) {
		if ( isUpdating[ variationId ] ) return;
		setIsUpdating( ( prevState ) => ( {
			...prevState,
			[ variationId ]: true,
		} ) );
		deleteProductVariation< Promise< ProductVariation > >( {
			product_id: productId,
			id: variationId,
		} )
			.then( () => {
				recordEvent( 'product_variations_delete', {
					source: TRACKS_SOURCE,
				} );
				invalidateResolution( 'getProductVariations', [
					requestParams,
				] );
			} )
			.finally( () => {
				setIsUpdating( ( prevState ) => ( {
					...prevState,
					[ variationId ]: false,
				} ) );
				onVariationTableChange( 'delete' );
			} );
	}

	function handleVariationChange(
		variationId: number,
		variation: Partial< ProductVariation >
	) {
		if ( isUpdating[ variationId ] ) return;
		setIsUpdating( ( prevState ) => ( {
			...prevState,
			[ variationId ]: true,
		} ) );
		updateProductVariation< Promise< ProductVariation > >(
			{ product_id: productId, id: variationId },
			variation
		)
			.then( () => {
				createSuccessNotice(
					/* translators: The updated variations count */
					sprintf( __( '%s variation/s updated.', 'woocommerce' ), 1 )
				);
			} )
			.catch( () => {
				createErrorNotice(
					__( 'Failed to save variation.', 'woocommerce' )
				);
			} )
			.finally( () => {
				setIsUpdating( ( prevState ) => ( {
					...prevState,
					[ variationId ]: false,
				} ) );
				onVariationTableChange( 'update', [ variation ] );
			} );
	}

	function handleUpdateAll( update: Partial< ProductVariation >[] ) {
		batchUpdateProductVariations< { update: [] } >(
			{ product_id: productId },
			{ update }
		)
			.then( ( response ) =>
				invalidateResolution( 'getProductVariations', [
					requestParams,
				] ).then( () => response )
			)
			.then( ( response ) => {
				createSuccessNotice(
					sprintf(
						/* translators: The updated variations count */
						__( '%s variation/s updated.', 'woocommerce' ),
						response.update.length
					)
				);
				onVariationTableChange( 'update', update );
			} )
			.catch( () => {
				createErrorNotice(
					__( 'Failed to update variations.', 'woocommerce' )
				);
			} );
	}

	function handleDeleteAll( values: Partial< ProductVariation >[] ) {
		batchUpdateProductVariations< { delete: [] } >(
			{ product_id: productId },
			{
				delete: values.map( ( { id } ) => id ),
			}
		)
			.then( ( response ) =>
				invalidateResolution( 'getProductVariations', [
					requestParams,
				] ).then( () => response )
			)
			.then( ( response ) => {
				createSuccessNotice(
					sprintf(
						/* translators: The updated variations count */
						__( '%s variation/s updated.', 'woocommerce' ),
						response.delete.length
					)
				);
				onVariationTableChange( 'delete' );
			} )
			.catch( () => {
				createErrorNotice(
					__( 'Failed to delete variations.', 'woocommerce' )
				);
			} );
	}

	return (
		<div className="woocommerce-product-variations" ref={ ref }>
			{ ( isLoading || isGeneratingVariations ) && (
				<div className="woocommerce-product-variations__loading">
					<Spinner />
					{ isGeneratingVariations && (
						<span>
							{ __( 'Generating variations…', 'woocommerce' ) }
						</span>
					) }
				</div>
			) }
			{ noticeText && (
				<Notice
					status={ noticeStatus }
					className="woocommerce-product-variations__notice"
					onRemove={ onNoticeDismiss }
					actions={ noticeActions.map( ( action ) => ( {
						...action,
						onClick: () => {
							action?.onClick( handleUpdateAll, handleDeleteAll );
						},
					} ) ) }
				>
					{ noticeText }
				</Notice>
			) }
			<div className="woocommerce-product-variations__header">
				<div className="woocommerce-product-variations__selection">
					<CheckboxControl
						value="all"
						checked={ areAllSelected( variationIds ) }
						// @ts-expect-error Property 'indeterminate' does not exist
						indeterminate={
							! areAllSelected( variationIds ) &&
							hasSelection( variationIds )
						}
						onChange={ onSelectAll( variationIds ) }
					/>
				</div>
				<div className="woocommerce-product-variations__filters">
					<Button
						variant="tertiary"
						disabled={ areAllSelected( variationIds ) }
						onClick={ () => onSelectAll( variationIds )( true ) }
					>
						{ __( 'Select all', 'woocommerce' ) }
					</Button>
					<Button
						variant="tertiary"
						disabled={ ! hasSelection( variationIds ) }
						onClick={ () => onClearSelection() }
					>
						{ __( 'Clear selection', 'woocommerce' ) }
					</Button>
				</div>
				<div>
					<VariationsActionsMenu
						selection={ variations.filter( ( variation ) =>
							isSelected( variation.id )
						) }
						disabled={ ! hasSelection( variationIds ) }
						onChange={ handleUpdateAll }
						onDelete={ handleDeleteAll }
					/>
				</div>
			</div>
			<Sortable className="woocommerce-product-variations__table">
				{ variations.map( ( variation ) => (
					<ListItem key={ `${ variation.id }` }>
						<div className="woocommerce-product-variations__selection">
							<CheckboxControl
								value={ variation.id }
								checked={ isSelected( variation.id ) }
								onChange={ onSelectItem( variation.id ) }
							/>
						</div>
						<div className="woocommerce-product-variations__attributes">
							{ variation.attributes.map( ( attribute ) => {
								const tag = (
									/* eslint-disable-next-line @typescript-eslint/ban-ts-comment */
									/* @ts-ignore Additional props are not required. */
									<Tag
										id={ attribute.id }
										className="woocommerce-product-variations__attribute"
										key={ attribute.id }
										label={ truncate( attribute.option, {
											length: PRODUCT_VARIATION_TITLE_LIMIT,
										} ) }
										screenReaderLabel={ attribute.option }
									/>
								);

								return attribute.option.length <=
									PRODUCT_VARIATION_TITLE_LIMIT ? (
									tag
								) : (
									<Tooltip
										key={ attribute.id }
										text={ attribute.option }
										position="top center"
									>
										<span>{ tag }</span>
									</Tooltip>
								);
							} ) }
						</div>
						<div
							className={ classnames(
								'woocommerce-product-variations__price',
								{
									'woocommerce-product-variations__price--fade':
										variation.status === 'private',
								}
							) }
						>
							{ variation.on_sale && (
								<span className="woocommerce-product-variations__sale-price">
									{ formatAmount( variation.sale_price ) }
								</span>
							) }
							<span
								className={ classnames(
									'woocommerce-product-variations__regular-price',
									{
										'woocommerce-product-variations__regular-price--on-sale':
											variation.on_sale,
									}
								) }
							>
								{ formatAmount( variation.regular_price ) }
							</span>
						</div>
						<div
							className={ classnames(
								'woocommerce-product-variations__quantity',
								{
									'woocommerce-product-variations__quantity--fade':
										variation.status === 'private',
								}
							) }
						>
							{ variation.regular_price && (
								<>
									<span
										className={ classnames(
											'woocommerce-product-variations__status-dot',
											getProductStockStatusClass(
												variation
											)
										) }
									>
										●
									</span>
									{ getProductStockStatus( variation ) }
								</>
							) }
						</div>
						<div className="woocommerce-product-variations__actions">
							{ ( variation.status === 'private' ||
								! variation.regular_price ) && (
								<Tooltip
									// @ts-expect-error className is missing in TS, should remove this when it is included.
									className="woocommerce-attribute-list-item__actions-tooltip"
									position="top center"
									text={ NOT_VISIBLE_TEXT }
								>
									<div>
										<HiddenWithHelpIcon />
									</div>
								</Tooltip>
							) }
							<VariationActionsMenu
								selection={ variation }
								onChange={ ( value ) =>
									handleVariationChange( variation.id, value )
								}
								onDelete={ ( { id } ) =>
									handleDeleteVariationClick( id )
								}
							/>
						</div>
					</ListItem>
				) ) }
			</Sortable>

			{ totalCount > 5 && (
				<div className="woocommerce-product-variations__footer woocommerce-pagination">
					<div>
						{ sprintf(
							__( 'Viewing %d-%d of %d items', 'woocommerce' ),
							paginationProps.start,
							paginationProps.end,
							totalCount
						) }
					</div>
					<PaginationPageArrowsWithPicker { ...paginationProps } />
					<PaginationPageSizePicker
						{ ...paginationProps }
						total={ totalCount }
						perPageOptions={ [ 5, 10, 25 ] }
						label=""
					/>
				</div>
			) }
		</div>
	);
} );
